/**
 * Settings route (TASK-081).
 *
 * Tabbed settings page per `docs/design.md` §9.2:
 *   - Profile — current user from `sessionStore` + logout.
 *   - Keys    — public-key fingerprint from `keyringStore`.
 *   - Appearance — theme / language / polling / auto-lock / notifications.
 *   - About   — version banner.
 *
 * All persisted settings are written through `useSettingsStore.set`,
 * which mirrors them to the Tauri LazyStore on disk.
 */

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Divider,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconCopy, IconLogout } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { changePublicKey } from "@/features/auth/api";
import { useSessionStore } from "@/features/auth/sessionStore";
import { isValidArmoredPublicKey } from "@/features/keyring/armor";
import { importPublicKey } from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { ColorSchemeToggle } from "@/ui/components/ColorSchemeToggle";

/**
 * Tab that replaces the local public key with a pasted armored PGP key.
 *
 * Per TASK-082: the private key is intentionally NOT touched — the
 * backend is told about the new public key, the local store is updated
 * in-place. Re-keying (private key rotation) is a separate flow handled
 * by re-running `SetupKeyRoute`.
 */
function ChangePublicKeyTab(): JSX.Element {
  const [armored, setArmored] = useState("");
  const [valid, setValid] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleValidate(): void {
    setValid(isValidArmoredPublicKey(armored));
  }

  async function handleSubmit(): Promise<void> {
    setError(null);
    setSuccess(false);
    if (!valid) {
      setError("Key not valid");
      return;
    }
    setBusy(true);
    try {
      await changePublicKey(armored);
      const pubKey = await importPublicKey(armored);
      useKeyringStore.setState({
        publicKey: pubKey,
        publicKeyArmored: armored,
        fingerprint: pubKey.getFingerprint().toUpperCase(),
      });
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper withBorder p="md">
      <Stack>
        <Text fw={500}>Replace public key</Text>
        <Text size="sm" c="dimmed">
          Paste an ASCII-armored PGP public key. Your private key remains
          unchanged.
        </Text>
        <Textarea
          label="Armored public key"
          placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
          autosize
          minRows={4}
          maxRows={10}
          value={armored}
          onChange={(e) => {
            setArmored(e.currentTarget.value);
            setValid(null);
          }}
        />
        <Group>
          <Button variant="default" onClick={handleValidate}>
            Validate
          </Button>
          {valid !== null &&
            (valid ? (
              <Badge color="green">Valid</Badge>
            ) : (
              <Badge color="red">Invalid</Badge>
            ))}
        </Group>
        {error !== null && <Alert color="red">{error}</Alert>}
        {success && <Alert color="green">Public key updated</Alert>}
        <Button
          onClick={() => void handleSubmit()}
          loading={busy}
          disabled={!valid}
        >
          Update public key
        </Button>
      </Stack>
    </Paper>
  );
}

export function SettingsRoute(): JSX.Element {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const lock = useSessionStore((s) => s.lock);
  const fingerprint = useKeyringStore((s) => s.fingerprint);
  const theme = useSettingsStore((s) => s.theme);
  const setSetting = useSettingsStore((s) => s.set);
  const language = useSettingsStore((s) => s.language);
  const pollingIntervalMs = useSettingsStore((s) => s.pollingIntervalMs);
  const idleTimeoutMs = useSettingsStore((s) => s.idleTimeoutMs);
  const autoLockEnabled = useSettingsStore((s) => s.autoLockEnabled);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);

  function handleLogout(): void {
    lock();
    navigate("/login", { replace: true });
  }

  return (
    <Stack gap="md" p="md" maw={800} mx="auto">
      <Title order={2}>Settings</Title>
      <Tabs defaultValue="profile">
        <Tabs.List>
          <Tabs.Tab value="profile">Profile</Tabs.Tab>
          <Tabs.Tab value="keys">Keys</Tabs.Tab>
          <Tabs.Tab value="change-key">Change key</Tabs.Tab>
          <Tabs.Tab value="appearance">Appearance</Tabs.Tab>
          <Tabs.Tab value="about">About</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="profile" pt="md">
          <Paper withBorder p="md">
            <Stack>
              <Group justify="space-between">
                <Text fw={500}>Email</Text>
                <Text>{user?.email ?? "—"}</Text>
              </Group>
              <Group justify="space-between">
                <Text fw={500}>User ID</Text>
                <Code>{user?.id ?? "—"}</Code>
              </Group>
              <Divider />
              <Button
                color="red"
                variant="light"
                leftSection={<IconLogout size={16} />}
                onClick={handleLogout}
              >
                Logout
              </Button>
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="keys" pt="md">
          <Paper withBorder p="md">
            <Stack>
              <Group justify="space-between">
                <Text fw={500}>Fingerprint</Text>
                <Group gap="xs">
                  <Code>{fingerprint ?? "No key set"}</Code>
                  {fingerprint !== null && (
                    <CopyButton value={fingerprint} timeout={1500}>
                      {({ copied, copy }) => (
                        <Tooltip
                          label={copied ? "Copied" : "Copy fingerprint"}
                          withArrow
                          position="top"
                        >
                          <ActionIcon
                            variant="subtle"
                            color={copied ? "teal" : "gray"}
                            onClick={copy}
                            aria-label="Copy fingerprint"
                          >
                            {copied ? (
                              <IconCheck size={14} />
                            ) : (
                              <IconCopy size={14} />
                            )}
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </CopyButton>
                  )}
                </Group>
              </Group>
              <Text size="sm" c="dimmed">
                Your public key fingerprint. Share this with your contacts to
                verify your identity.
              </Text>
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="change-key" pt="md">
          <ChangePublicKeyTab />
        </Tabs.Panel>

        <Tabs.Panel value="appearance" pt="md">
          <Stack>
            <Paper withBorder p="md">
              <Stack>
                <Text fw={500}>Theme</Text>
                <Group>
                  <ColorSchemeToggle />
                  <Text size="sm" c="dimmed">
                    Current: {theme}
                  </Text>
                </Group>
              </Stack>
            </Paper>
            <Paper withBorder p="md">
              <Stack>
                <Text fw={500}>Language</Text>
                <SegmentedControl
                  value={language}
                  onChange={(v) => void setSetting("language", v as "en" | "ru")}
                  data={[
                    { value: "ru", label: "Русский" },
                    { value: "en", label: "English" },
                  ]}
                />
              </Stack>
            </Paper>
            <Paper withBorder p="md">
              <Stack>
                <Text fw={500}>Polling interval (ms)</Text>
                <NumberInput
                  value={pollingIntervalMs}
                  onChange={(v) =>
                    void setSetting(
                      "pollingIntervalMs",
                      typeof v === "number" ? v : 5000,
                    )
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
                  onChange={(e) =>
                    void setSetting("autoLockEnabled", e.currentTarget.checked)
                  }
                  label="Auto-lock on idle"
                />
                {autoLockEnabled && (
                  <NumberInput
                    label="Idle timeout (ms)"
                    value={idleTimeoutMs}
                    onChange={(v) =>
                      void setSetting(
                        "idleTimeoutMs",
                        typeof v === "number" ? v : 300000,
                      )
                    }
                    min={60000}
                    max={3600000}
                    step={60000}
                  />
                )}
                <Switch
                  checked={notificationsEnabled}
                  onChange={(e) =>
                    void setSetting(
                      "notificationsEnabled",
                      e.currentTarget.checked,
                    )
                  }
                  label="Notifications"
                />
              </Stack>
            </Paper>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="about" pt="md">
          <Paper withBorder p="md">
            <Stack>
              <Text fw={500}>Quant Messenger</Text>
              <Text size="sm" c="dimmed">
                v0.1.0 — alpha
              </Text>
              <Text size="sm">
                E2E-encrypted messenger. Zero-knowledge architecture.
              </Text>
              <Badge color="green" variant="light">
                MIT License
              </Badge>
            </Stack>
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
