/**
 * Onboarding route for first-time PGP key setup.
 *
 * Four tabs, one per flow described in `docs/design.md` §9.2:
 *   - **Generate** — create a fresh ECC key, persist to keystore, push
 *     public key to the server, redirect to `/chats`.
 *   - **Import**   — paste an existing armored private key, unlock with
 *     its passphrase, persist, redirect.
 *   - **Export**   — write the current keystore to a user-chosen
 *     `.qks.json` file as a manual backup.
 *   - **Share**    — reveal the existing private key as ASCII-armored
 *     text + QR code for migrating to another device. Requires
 *     passphrase + an explicit risk-acknowledgement checkbox; the
 *     plaintext key is wiped from component state the moment the user
 *     leaves the tab.
 *
 * Progress feedback on the Generate tab is a coarse 20/80/100 bar:
 * generation is local and blocking, but the network upload is what
 * actually wants visibility, so the bar advances on each major step.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
// eslint-disable-next-line import/no-named-as-default
import QRCode from "react-qr-code";
import {
  Alert,
  Button,
  Checkbox,
  Code,
  CopyButton,
  Group,
  Paper,
  PasswordInput,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconCheck, IconCopy, IconDownload, IconEye, IconShieldLock } from "@tabler/icons-react";

import { useSessionStore } from "@/features/auth/sessionStore";
import {
  generateAndStoreKey,
  importAndStoreKey,
  exportKeystoreToFile,
} from "@/features/keyring/generate";
import type { KeyAlgorithm } from "@/features/keyring/types";
import { changePublicKey } from "@/features/auth/api";
import { readKeystore } from "@/features/secure-store/store";
import { pickSaveFile, writeFileBuffer } from "@/infra/tauriBridge";
import { toUserMessage } from "@/infra/error";
import { debugLog, getDebugLogLocation } from "@/lib/debug";

function formatDebugForDisplay(err: unknown): string {
  const info = {
    type: typeof err,
    constructor: (err as { constructor?: { name?: string } })?.constructor?.name ?? "?",
    value: safeStr(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  return JSON.stringify(info, null, 2);
}

function safeStr(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function SetupKeyRoute(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const [tab, setTab] = useState<string | null>("generate");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [algorithm, setAlgorithm] = useState<KeyAlgorithm>("ecc");
  const [armored, setArmored] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rawError, setRawError] = useState<unknown>(null);
  const [debugDetails, setDebugDetails] = useState<string>("");
  const [debugLoc, setDebugLoc] = useState<string>("");

  useEffect(() => {
    setDebugLoc(getDebugLogLocation());
  }, []);

  useEffect(() => {
    return () => {
      setRawError(null);
      setDebugDetails("");
    };
  }, []);

  // Share-tab state: kept narrow so the secret is wiped the moment the
  // user navigates away (see the `useEffect` cleanup below).
  const [shareConfirmed, setShareConfirmed] = useState(false);
  const [shareRevealed, setShareRevealed] = useState(false);
  const [privateKeyArmored, setPrivateKeyArmored] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      setPrivateKeyArmored(null);
      setShareRevealed(false);
    };
  }, [tab]);

  async function handleGenerate(): Promise<void> {
    setError(null);
    setRawError(null);
    setDebugDetails("");
    if (passphrase !== confirm) {
      setError(t("setupKey.errors.passphrasesMismatch"));
      return;
    }
    if (user === null) {
      setError(t("setupKey.errors.noUser"));
      return;
    }
    setBusy(true);
    setProgress(20);
    try {
      const pair = await generateAndStoreKey(user.email, passphrase, undefined, algorithm);
      setProgress(80);
      await changePublicKey(pair.publicKeyArmored);
      setProgress(100);
      navigate("/chats", { replace: true });
    } catch (e) {
      console.error(
        "[Generate] error:",
        e,
        "type:",
        typeof e,
        "constructor:",
        (e as { constructor?: { name?: string } })?.constructor?.name,
      );
      void debugLog("Generate", e, { algorithm, hasUser: user !== null });
      setRawError(e);
      setDebugDetails(formatDebugForDisplay(e));
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(): Promise<void> {
    setError(null);
    setRawError(null);
    setDebugDetails("");
    if (!armored.includes("BEGIN PGP PRIVATE KEY")) {
      setError(t("setupKey.import.invalidKey"));
      return;
    }
    if (user === null) {
      setError(t("setupKey.errors.noUser"));
      return;
    }
    setBusy(true);
    try {
      const splitMarker = "-----BEGIN PGP PUBLIC KEY-----";
      const privatePart = armored.split(splitMarker)[0] ?? armored;
      const publicPart = armored.includes(splitMarker)
        ? `${splitMarker}${armored.split(splitMarker)[1] ?? ""}`
        : "";
      await importAndStoreKey(privatePart, publicPart, passphrase, user.email);
      navigate("/chats", { replace: true });
    } catch (e) {
      void debugLog("Import", e, { hasUser: user !== null });
      setRawError(e);
      setDebugDetails(formatDebugForDisplay(e));
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(): Promise<void> {
    setError(null);
    setRawError(null);
    setDebugDetails("");
    setSuccess(null);
    if (user === null) {
      setError(t("setupKey.errors.noUser"));
      return;
    }
    try {
      const path = await exportKeystoreToFile(user.id, passphrase);
      if (path !== null) {
        setSuccess(t("setupKey.export.savedTo", { path }));
      }
    } catch (e) {
      void debugLog("Export", e);
      setRawError(e);
      setDebugDetails(formatDebugForDisplay(e));
      setError(toUserMessage(e));
    }
  }

  async function handleReveal(): Promise<void> {
    setError(null);
    setRawError(null);
    setDebugDetails("");
    if (user === null) {
      setError(t("setupKey.errors.noUser"));
      return;
    }
    try {
      const keystore = await readKeystore(user.id, passphrase);
      setPrivateKeyArmored(keystore.privateKeyArmored);
      setShareRevealed(true);
    } catch (e) {
      void debugLog("Reveal", e);
      setRawError(e);
      setDebugDetails(formatDebugForDisplay(e));
      setError(toUserMessage(e));
    }
  }

  async function handleDownload(): Promise<void> {
    if (privateKeyArmored === null) return;
    setBusy(true);
    setError(null);
    setRawError(null);
    setDebugDetails("");
    setSuccess(null);
    try {
      const path = await pickSaveFile({
        defaultPath: "private-key.asc",
        filters: [{ name: "ASCII-armored", extensions: ["asc", "txt"] }],
      });
      if (path === null) return;
      await writeFileBuffer(path, new TextEncoder().encode(privateKeyArmored));
      setSuccess(t("setupKey.export.savedTo", { path }));
    } catch (e) {
      void debugLog("Download", e);
      setRawError(e);
      setDebugDetails(formatDebugForDisplay(e));
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper p="md" maw={600} mx="auto" mt={40}>
      <Title order={2} mb="md">
        {t("setupKey.title")}
      </Title>
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="generate">{t("setupKey.tabs.generate")}</Tabs.Tab>
          <Tabs.Tab value="import">{t("setupKey.tabs.import")}</Tabs.Tab>
          <Tabs.Tab value="export">{t("setupKey.tabs.export")}</Tabs.Tab>
          <Tabs.Tab value="share">{t("setupKey.tabs.share")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="generate" pt="md">
          <Stack>
            <Text size="sm">{t("setupKey.generate.description")}</Text>
            <Alert color="yellow">{t("setupKey.emptyPassphraseWarning")}</Alert>
            <PasswordInput
              label={t("setupKey.passphraseOptional")}
              value={passphrase}
              onChange={(e) => setPassphrase(e.currentTarget.value)}
            />
            <PasswordInput
              label={t("setupKey.passphraseOptional")}
              value={confirm}
              onChange={(e) => setConfirm(e.currentTarget.value)}
            />
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                {t("setupKey.generate.algorithm")}
              </Text>
              <SegmentedControl
                value={algorithm}
                onChange={(v) => setAlgorithm(v as KeyAlgorithm)}
                data={[
                  { value: "ecc", label: t("setupKey.generate.eccLabel") },
                  { value: "rsa", label: t("setupKey.generate.rsaLabel") },
                ]}
                fullWidth
              />
              <Text size="xs" c="dimmed">
                {t("setupKey.generate.algorithmHelp")}
              </Text>
            </Stack>
            {progress > 0 && <Progress value={progress} />}
            {rawError !== null && (
              <>
                <Alert color="red">{error}</Alert>
                <details style={{ cursor: "pointer", marginTop: 4 }}>
                  <summary
                    style={{
                      color: "var(--mantine-color-dimmed)",
                      fontSize: "0.85em",
                      padding: "4px 0",
                    }}
                  >
                    🔍 Debug info — log: {debugLoc}
                  </summary>
                  <Code block fz="xs" mt="xs">
                    {debugDetails}
                  </Code>
                </details>
              </>
            )}
            <Button onClick={() => void handleGenerate()} loading={busy}>
              {t("setupKey.generate.submit")}
            </Button>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="import" pt="md">
          <Stack>
            <Text size="sm">{t("setupKey.import.description")}</Text>
            <TextInput
              label={t("setupKey.import.armoredLabel")}
              value={armored}
              onChange={(e) => setArmored(e.currentTarget.value)}
              placeholder={t("setupKey.import.armoredPlaceholder")}
            />
            <PasswordInput
              label={t("setupKey.passphraseImportLabel")}
              value={passphrase}
              onChange={(e) => setPassphrase(e.currentTarget.value)}
            />
            {rawError !== null && (
              <>
                <Alert color="red">{error}</Alert>
                <details style={{ cursor: "pointer", marginTop: 4 }}>
                  <summary
                    style={{
                      color: "var(--mantine-color-dimmed)",
                      fontSize: "0.85em",
                      padding: "4px 0",
                    }}
                  >
                    🔍 Debug info — log: {debugLoc}
                  </summary>
                  <Code block fz="xs" mt="xs">
                    {debugDetails}
                  </Code>
                </details>
              </>
            )}
            <Button onClick={() => void handleImport()} loading={busy}>
              {t("setupKey.import.submit")}
            </Button>
            <Code block fz="xs">
              {t("setupKey.import.tip")}
            </Code>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="export" pt="md">
          <Stack>
            <Text size="sm">{t("setupKey.export.description")}</Text>
            <PasswordInput
              label={t("setupKey.passphraseVerifyLabel")}
              value={passphrase}
              onChange={(e) => setPassphrase(e.currentTarget.value)}
            />
            {rawError !== null && (
              <>
                <Alert color="red">{error}</Alert>
                <details style={{ cursor: "pointer", marginTop: 4 }}>
                  <summary
                    style={{
                      color: "var(--mantine-color-dimmed)",
                      fontSize: "0.85em",
                      padding: "4px 0",
                    }}
                  >
                    🔍 Debug info — log: {debugLoc}
                  </summary>
                  <Code block fz="xs" mt="xs">
                    {debugDetails}
                  </Code>
                </details>
              </>
            )}
            {success !== null && <Alert color="green">{success}</Alert>}
            <Button onClick={() => void handleExport()}>{t("setupKey.export.submit")}</Button>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="share" pt="md">
          <Stack>
            <Alert
              color="red"
              icon={<IconShieldLock size={16} />}
              title={t("setupKey.share.title")}
            >
              <Text size="sm">{t("setupKey.share.warning1")}</Text>
              <Text size="sm" mt="xs">
                {t("setupKey.share.warning2")}
              </Text>
              <Text size="sm" mt="xs">
                {t("setupKey.share.warning3")}
              </Text>
            </Alert>
            <PasswordInput
              label={t("setupKey.sharePassphraseLabel")}
              placeholder={t("setupKey.share.passphrasePlaceholder")}
              value={passphrase}
              onChange={(e) => setPassphrase(e.currentTarget.value)}
            />
            <Checkbox
              label={t("setupKey.share.confirmCheckbox")}
              checked={shareConfirmed}
              onChange={(e) => setShareConfirmed(e.currentTarget.checked)}
            />
            {rawError !== null && (
              <>
                <Alert color="red">{error}</Alert>
                <details style={{ cursor: "pointer", marginTop: 4 }}>
                  <summary
                    style={{
                      color: "var(--mantine-color-dimmed)",
                      fontSize: "0.85em",
                      padding: "4px 0",
                    }}
                  >
                    🔍 Debug info — log: {debugLoc}
                  </summary>
                  <Code block fz="xs" mt="xs">
                    {debugDetails}
                  </Code>
                </details>
              </>
            )}
            {!shareRevealed && (
              <Button
                leftSection={<IconEye size={16} />}
                onClick={() => void handleReveal()}
                disabled={!shareConfirmed}
              >
                {t("setupKey.share.reveal")}
              </Button>
            )}
            {shareRevealed && privateKeyArmored !== null && (
              <Stack gap="xs">
                <Group justify="space-between" align="center">
                  <Text size="xs" c="dimmed">
                    {t("setupKey.share.revealedLabel")}
                  </Text>
                  <CopyButton value={privateKeyArmored} timeout={1500}>
                    {({ copied, copy }) => (
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                        onClick={copy}
                      >
                        {copied ? t("setupKey.share.copied") : t("setupKey.share.copy")}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
                <ScrollArea h={200}>
                  <Code block fz="xs">
                    {privateKeyArmored}
                  </Code>
                </ScrollArea>
                <Button
                  variant="light"
                  leftSection={<IconDownload size={16} />}
                  onClick={() => void handleDownload()}
                  loading={busy}
                >
                  {t("setupKey.share.download")}
                </Button>
                <Group justify="center">
                  <QRCode value={privateKeyArmored} size={256} />
                </Group>
                {privateKeyArmored.length > 2500 && (
                  <Alert color="yellow">{t("setupKey.share.qrWarning")}</Alert>
                )}
              </Stack>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
