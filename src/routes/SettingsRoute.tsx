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
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { clearDebugLog, getDebugLog, getDebugLogLocation } from "@/lib/debug";
import { ColorSchemeToggle } from "@/ui/components/ColorSchemeToggle";

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
  const idleTimeoutMs = useSettingsStore((s) => s.idleTimeoutMs);
  const autoLockEnabled = useSettingsStore((s) => s.autoLockEnabled);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);

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
                <Text fw={500}>{t("settings.pollingInterval")}</Text>
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
