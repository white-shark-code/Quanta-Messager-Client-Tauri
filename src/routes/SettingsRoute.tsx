/**
 * Settings route (TASK-081).
 *
 * Tabbed settings page per `docs/design.md` §9.2:
 *   - Profile    — current user from `sessionStore` + logout.
 *   - Appearance — theme / language / polling / auto-lock / notifications.
 *   - About      — version banner.
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
  Stack,
  Switch,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLogout, IconRefresh } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useSessionStore } from "@/features/auth/sessionStore";
import { deleteKeystoreForUser } from "@/features/keyring/generate";
import { fingerprintOf } from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { usePushToggle } from "@/features/push/usePushToggle";
import { isPushApiAvailable } from "@/features/push/support";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { useWsStatusStore } from "@/features/events/wsStatusStore";
import { useUserPublicKey } from "@/features/users/queries";
import { clearDebugLog, getDebugLog, getDebugLogLocation } from "@/lib/debug";
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
  const lock = useSessionStore((s) => s.lock);
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
  const { pending: pushPending, reason: pushReason, togglePush } = usePushToggle();

  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
  const [eraseData, setEraseData] = useState(false);

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
    lock();
    setEraseData(false);
    closeConfirm();
    navigate("/login", { replace: true });
  }

  return (
    <Stack gap="md" p="md" maw={800} mx="auto">
      <Title order={2}>{t("settings.title")}</Title>
      <Tabs defaultValue="profile">
        <Tabs.List>
          <Tabs.Tab value="profile">{t("settings.profile")}</Tabs.Tab>
          <Tabs.Tab value="appearance">{t("settings.appearance")}</Tabs.Tab>
          <Tabs.Tab value="about">{t("settings.about")}</Tabs.Tab>
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
              <Stack>
                <Text fw={500}>Quant Messenger</Text>
                <Text size="sm" c="dimmed">
                  {t("settings.version")}
                </Text>
                <Text size="sm">{t("settings.aboutDescription")}</Text>
                <Badge color="green" variant="light">
                  MIT License
                </Badge>
              </Stack>
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
    </Stack>
  );
}
