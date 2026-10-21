/**
 * Settings route (TASK-081).
 *
 * Tabbed settings page per `docs/design.md` §9.2:
 *   - Profile    — current user from `sessionStore` + logout.
 *   - Appearance — theme / language / polling / auto-lock / notifications.
 *   - About      — version banner.
 *   - Storage    — local retention sweep (dialogs / media vault).
 *
 * Key management lives exclusively on `/setup-key` (Generate / Import /
 * Export / Share tabs). It is not surfaced here.
 *
 * All persisted settings are written through `useSettingsStore.set`,
 * which mirrors them to the Tauri LazyStore on disk.
 */

import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Code,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLogout, IconRefresh, IconTrashX } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { useSessionStore } from "@/features/auth/sessionStore";
import { deleteKeystoreForUser } from "@/features/keyring/generate";
import { fingerprintOf } from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { clearBlobCache } from "@/features/media/decrypt";
import { clearDecryptedCache } from "@/features/messages/queries";
import { usePushToggle } from "@/features/push/usePushToggle";
import { isPushApiAvailable } from "@/features/push/support";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { wipeDeviceData } from "@/features/settings/wipeLocalData";
import { useWsStatusStore } from "@/features/events/wsStatusStore";
import { useUserPublicKey } from "@/features/users/queries";
import { clearDebugLog, getDebugLog, getDebugLogLocation } from "@/lib/debug";
import { BrandTile } from "@/ui/components/BrandLogo";
import { ColorSchemeToggle } from "@/ui/components/ColorSchemeToggle";

/**
 * Local-vs-server PGP fingerprint comparison.
 *
 * The local fingerprint comes from the in-memory keyring (the key this
 * device actually encrypts/signs with); the server one is fetched via
 * the same public-key lookup the chat uses. A mismatch means this
 * device holds a stale keypair (e.g. key setup was repeated in another
 * browser) — messages will decrypt but never verify, and sends from
 * here target the wrong identity. The fix is to re-run key setup on
 * this device, not to touch the chat code.
 */
function KeyFingerprints({ userId }: { userId: string | undefined }): JSX.Element | null {
  const { t } = useTranslation();
  const localFingerprint = useKeyringStore((s) => s.fingerprint);
  const serverKey = useUserPublicKey(userId);
  const [serverFingerprint, setServerFingerprint] = useState<string | null>(null);

  useEffect(() => {
    const armor = serverKey.data?.public_key ?? null;
    if (serverKey.data?.has_public_key !== true || armor === null) {
      setServerFingerprint(null);
      return;
    }
    let cancelled = false;
    void fingerprintOf(armor)
      .then((fp) => {
        if (!cancelled) setServerFingerprint(fp);
      })
      .catch(() => {
        if (!cancelled) setServerFingerprint(null);
      });
    return () => {
      cancelled = true;
    };
  }, [serverKey.data]);

  if (userId === undefined) return null;
  const comparable = localFingerprint !== null && serverFingerprint !== null;
  const match = comparable && localFingerprint === serverFingerprint;

  return (
    <Paper withBorder p="md">
      <Stack>
        <Text fw={500}>{t("settings.keysTitle")}</Text>
        <Group justify="space-between">
          <Text>{t("settings.localFingerprint")}</Text>
          <Code>{localFingerprint ?? "—"}</Code>
        </Group>
        <Group justify="space-between">
          <Text>{t("settings.serverFingerprint")}</Text>
          <Code>{serverKey.isFetching ? "…" : (serverFingerprint ?? "—")}</Code>
        </Group>
        {comparable && (
          <Group>
            <Badge color={match ? "green" : "red"}>
              {match ? t("settings.keysMatch") : t("settings.keysMismatch")}
            </Badge>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

export function SettingsRoute(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const logout = useSessionStore((s) => s.logout);
  const clearKeyring = useKeyringStore((s) => s.clear);
  const theme = useSettingsStore((s) => s.theme);
  const setSetting = useSettingsStore((s) => s.set);
  const language = useSettingsStore((s) => s.language);
  const pollingIntervalMs = useSettingsStore((s) => s.pollingIntervalMs);
  const realtimeMode = useSettingsStore((s) => s.realtimeMode);
  const wsStatus = useWsStatusStore((s) => s.status);
  const idleTimeoutMs = useSettingsStore((s) => s.idleTimeoutMs);
  const autoLockEnabled = useSettingsStore((s) => s.autoLockEnabled);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const pushEnabled = useSettingsStore((s) => s.pushEnabled);
  const chatRetentionDays = useSettingsStore((s) => s.chatRetentionDays);
  const mediaRetentionDays = useSettingsStore((s) => s.mediaRetentionDays);
  // Slider drafts: dragging must not persist on every tick (each `set`
  // re-writes settings.json), so the value is committed on release and
  // re-synced whenever the store changes from elsewhere.
  const [chatRetentionDraft, setChatRetentionDraft] = useState(chatRetentionDays);
  const [mediaRetentionDraft, setMediaRetentionDraft] = useState(mediaRetentionDays);
  useEffect(() => {
    setChatRetentionDraft(chatRetentionDays);
  }, [chatRetentionDays]);
  useEffect(() => {
    setMediaRetentionDraft(mediaRetentionDays);
  }, [mediaRetentionDays]);
  const { pending: pushPending, reason: pushReason, togglePush } = usePushToggle();

  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
  const [wipeOpenState, { open: wipeOpen, close: wipeClose }] = useDisclosure(false);
  const [eraseData, setEraseData] = useState(false);
  const queryClient = useQueryClient();

  // Diagnostics panel state.
  const [debugContent, setDebugContent] = useState<string>("");
  const [debugLocation, setDebugLocation] = useState<string>("");
  async function refreshDebugLog(): Promise<void> {
    setDebugLocation(getDebugLogLocation());
    setDebugContent(await getDebugLog());
  }
  useEffect(() => {
    void refreshDebugLog();
  }, []);

  // Web Push is unavailable when the platform lacks the APIs (old browsers,
  // some WebViews). ungoogled-chromium and friends DO expose the APIs but
  // can never reach a vendor push service — that surfaces as
  // `subscribe-failed` on toggle, with its own explainer below.
  const pushSupported = isPushApiAvailable();

  // Helper text under the push switch: known B1 reasons get a dedicated
  // string, anything else is shown raw via `settings.pushError`.
  let pushReasonText: string | null = null;
  if (pushReason === "denied") {
    pushReasonText = t("settings.pushDenied");
  } else if (pushReason === "no-vapid") {
    pushReasonText = t("settings.pushNoVapid");
  } else if (pushReason === "subscribe-failed") {
    pushReasonText = t("settings.pushSubscribeFailed");
  } else if (pushReason !== null) {
    pushReasonText = t("settings.pushError", { reason: pushReason });
  }

  async function handleLogout(): Promise<void> {
    const uid = user?.id;
    if (uid !== undefined && eraseData) {
      try {
        await deleteKeystoreForUser(uid);
      } catch {
        // best-effort — still proceed with logout
      }
    }
    // `clear()` wipes the in-memory keyring entirely (public + private +
    // fingerprint) so a subsequent login can't be misled by stale
    // `publicKeyArmored` pointing at a deleted keystore file.
    clearKeyring();
    logout();
    setEraseData(false);
    closeConfirm();
    navigate("/login", { replace: true });
  }

  /**
   * Wipe device data (TASK: settings → profile): erase every local
   * artifact (dialogs, media vault, keystore), drop RAM caches of
   * already-decrypted content plus the react-query message cache, then
   * exit the session. Best-effort: a wipe failure must not strand the
   * user on a half-functional settings screen.
   */
  async function handleWipe(): Promise<void> {
    const uid = user?.id;
    if (uid !== undefined) {
      try {
        await wipeDeviceData(uid);
      } catch {
        // best-effort
      }
    }
    clearDecryptedCache();
    clearBlobCache();
    queryClient.removeQueries({ queryKey: ["messages"] });
    clearKeyring();
    logout();
    wipeClose();
    navigate("/login", { replace: true });
  }

  const retentionMaxDays = 365;
  const retentionMarks = [
    { value: 0, label: t("settings.retentionForever") },
    { value: 30, label: "30" },
    { value: 90, label: "90" },
    { value: 365, label: "365" },
  ];
  /** 0 → "Всегда", 365 → "1 год", everything else → "N дн.". */
  const formatRetention = (days: number): string => {
    if (days <= 0) return t("settings.retentionForever");
    if (days >= retentionMaxDays) return t("settings.retentionYear");
    return t("settings.retentionDays", { days });
  };
  const clampRetention = (days: number): number =>
    Math.min(retentionMaxDays, Math.max(0, Math.round(days)));

  return (
    <Stack gap="md" p="md" maw={800} mx="auto">
      <Title order={2}>{t("settings.title")}</Title>
      <Tabs defaultValue="profile">
        <Tabs.List>
          <Tabs.Tab value="profile">{t("settings.profile")}</Tabs.Tab>
          <Tabs.Tab value="appearance">{t("settings.appearance")}</Tabs.Tab>
          <Tabs.Tab value="about">{t("settings.about")}</Tabs.Tab>
          <Tabs.Tab value="storage">{t("settings.storageTab")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="profile" pt="md">
          <Paper withBorder p="md">
            <Stack>
              <Group justify="space-between">
                <Text fw={500}>{t("settings.email")}</Text>
                <Text>{user?.email ?? "—"}</Text>
              </Group>
              <Group justify="space-between">
                <Text fw={500}>{t("settings.userId")}</Text>
                <Code>{user?.id ?? "—"}</Code>
              </Group>
              <Divider />
              <Button
                color="red"
                variant="light"
                leftSection={<IconLogout size={16} />}
                onClick={openConfirm}
              >
                {t("auth.logout")}
              </Button>
              <Divider />
              <Button
                color="red"
                variant="subtle"
                leftSection={<IconTrashX size={16} />}
                onClick={wipeOpen}
                fullWidth
              >
                {t("settings.wipeDataButton")}
              </Button>
            </Stack>
          </Paper>
          <KeyFingerprints userId={user?.id} />
        </Tabs.Panel>

        <Tabs.Panel value="appearance" pt="md">
          <Stack>
            <Paper withBorder p="md">
              <Stack>
                <Text fw={500}>{t("settings.theme")}</Text>
                <Group>
                  <ColorSchemeToggle />
                  <Text size="sm" c="dimmed">
                    {t("settings.currentTheme", { theme })}
                  </Text>
                </Group>
              </Stack>
            </Paper>
            <Paper withBorder p="md">
              <Stack>
                <Text fw={500}>{t("settings.language")}</Text>
                <SegmentedControl
                  value={language}
                  onChange={(v) => void setSetting("language", v as "en" | "ru" | "vi")}
                  data={[
                    { value: "ru", label: "Русский" },
                    { value: "en", label: "English" },
                    { value: "vi", label: "Tiếng Việt" },
                  ]}
                />
              </Stack>
            </Paper>
            <Paper withBorder p="md">
              <Stack>
                <Text fw={500}>{t("settings.realtimeMode")}</Text>
                <SegmentedControl
                  value={realtimeMode}
                  onChange={(v) => void setSetting("realtimeMode", v as "ws" | "polling")}
                  data={[
                    { value: "ws", label: t("settings.realtimeWs") },
                    { value: "polling", label: t("settings.realtimePolling") },
                  ]}
                />
                <Text size="sm" c="dimmed">
                  {t("settings.wsStatus", { status: wsStatus })}
                </Text>
              </Stack>
            </Paper>
            <Paper withBorder p="md">
              <Stack>
                <Text fw={500}>
                  {realtimeMode === "ws"
                    ? t("settings.pollingIntervalFallback")
                    : t("settings.pollingInterval")}
                </Text>
                <NumberInput
                  value={pollingIntervalMs}
                  onChange={(v) =>
                    void setSetting("pollingIntervalMs", typeof v === "number" ? v : 5000)
                  }
                  min={1000}
                  max={60000}
                  step={1000}
                />
              </Stack>
            </Paper>
            <Paper withBorder p="md">
              <Stack>
                <Switch
                  checked={autoLockEnabled}
                  onChange={(e) => void setSetting("autoLockEnabled", e.currentTarget.checked)}
                  label={t("settings.autoLock")}
                />
                {autoLockEnabled && (
                  <NumberInput
                    label={t("settings.idleTimeout")}
                    value={idleTimeoutMs}
                    onChange={(v) =>
                      void setSetting("idleTimeoutMs", typeof v === "number" ? v : 300000)
                    }
                    min={60000}
                    max={3600000}
                    step={60000}
                  />
                )}
                <Switch
                  checked={notificationsEnabled}
                  onChange={(e) => void setSetting("notificationsEnabled", e.currentTarget.checked)}
                  label={t("settings.notifications")}
                />
                {pushSupported ? (
                  <>
                    <Switch
                      checked={pushEnabled}
                      disabled={pushPending}
                      onChange={(e) => void togglePush(e.currentTarget.checked)}
                      label={t("settings.pushTitle")}
                    />
                    {pushReasonText !== null && (
                      <Text size="sm" c="dimmed">
                        {pushReasonText}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    {t("settings.pushUnsupported")}
                  </Text>
                )}
              </Stack>
            </Paper>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="about" pt="md">
          <Stack>
            <Paper withBorder p="md">
              <Group align="flex-start" wrap="nowrap">
                <BrandTile size={64} />
                <Stack gap={4}>
                  <Text fw={500}>Quant Messenger</Text>
                  <Text size="sm" c="dimmed">
                    {t("settings.version")}
                  </Text>
                  <Text size="sm">{t("settings.aboutDescription")}</Text>
                  <Badge color="green" variant="light" style={{ alignSelf: "flex-start" }}>
                    MIT License
                  </Badge>
                </Stack>
              </Group>
            </Paper>
            <Paper withBorder p="md">
              <Stack>
                <Text fw={500}>{t("settings.diagnostics.title")}</Text>
                <Text size="xs" c="dimmed">
                  {t("settings.diagnostics.locationLabel")}
                </Text>
                <Code block>{debugLocation}</Code>
                <Group>
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconRefresh size={14} />}
                    onClick={() => void refreshDebugLog()}
                  >
                    {t("settings.diagnostics.refresh")}
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => {
                      void clearDebugLog().then(() => {
                        void refreshDebugLog();
                      });
                    }}
                  >
                    {t("settings.diagnostics.clear")}
                  </Button>
                </Group>
                <ScrollArea h={240}>
                  <Code block fz="xs">
                    {debugContent.length > 0 ? debugContent : t("settings.diagnostics.empty")}
                  </Code>
                </ScrollArea>
              </Stack>
            </Paper>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="storage" pt="md">
          <Paper withBorder p="md">
            <Stack>
              <Group justify="space-between">
                <Text fw={500}>{t("settings.chatRetention")}</Text>
                <Badge variant="light" tt="none">
                  {formatRetention(chatRetentionDays)}
                </Badge>
              </Group>
              <Slider
                value={clampRetention(chatRetentionDraft)}
                onChange={setChatRetentionDraft}
                onChangeEnd={(v) => void setSetting("chatRetentionDays", v)}
                min={0}
                max={retentionMaxDays}
                step={1}
                marks={retentionMarks}
                label={formatRetention}
                mb="lg"
              />
              <Group justify="space-between">
                <Text fw={500}>{t("settings.mediaRetention")}</Text>
                <Badge variant="light" tt="none">
                  {formatRetention(mediaRetentionDays)}
                </Badge>
              </Group>
              <Slider
                value={clampRetention(mediaRetentionDraft)}
                onChange={setMediaRetentionDraft}
                onChangeEnd={(v) => void setSetting("mediaRetentionDays", v)}
                min={0}
                max={retentionMaxDays}
                step={1}
                marks={retentionMarks}
                label={formatRetention}
                mb="lg"
              />
              <Text size="sm" c="dimmed">
                {t("settings.retentionNote")}
              </Text>
            </Stack>
          </Paper>
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={confirmOpened}
        onClose={closeConfirm}
        title={t("settings.logoutConfirmTitle")}
        centered
      >
        <Stack>
          <Text size="sm">{t("settings.logoutConfirmText")}</Text>
          <Checkbox
            label={t("settings.logoutEraseData")}
            checked={eraseData}
            onChange={(e) => setEraseData(e.currentTarget.checked)}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={closeConfirm}>
              {t("common.cancel")}
            </Button>
            <Button color="red" onClick={() => void handleLogout()}>
              {t("auth.logout")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={wipeOpenState}
        onClose={wipeClose}
        title={t("settings.wipeDataConfirmTitle")}
        centered
      >
        <Stack>
          <Text size="sm">{t("settings.wipeDataConfirmText")}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={wipeClose}>
              {t("common.cancel")}
            </Button>
            <Button color="red" onClick={() => void handleWipe()}>
              {t("settings.wipeDataAction")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
