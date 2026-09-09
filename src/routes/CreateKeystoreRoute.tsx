/**
 * Dedicated full-screen route for first-time keystore creation.
 *
 * Triggered automatically after a successful `/auth/login` when no
 * `keystore.qks` is on disk (see `useLogin.onSuccess`). Unlike the
 * broader `/setup-key` page (which exposes 4 tabs: generate / import /
 * export / share for advanced flows), this route is intentionally
 * minimal — passphrase + PGP mode + one button — so the "you must set
 * up a keystore before you can chat" step is unambiguous.
 *
 * Two independent secrets are captured here:
 *   1. **Keystore passphrase** — required, encrypts the ChaCha20-Poly1305
 *      container that holds the access token + private key on disk.
 *      There is NO "no passphrase" mode for the keystore — without a
 *      passphrase the on-disk file would be plaintext JSON and the
 *      "zero-knowledge" claim would collapse.
 *   2. **PGP key passphrase** — optional, encrypts the PGP private key
 *      packet itself. Only relevant in `pgpMode === "generate"` or
 *      `"import"`.
 *
 * Three PGP modes are offered (user picks one):
 *   - **"generate"** — create a fresh PGP keypair on this device.
 *   - **"import"**  — paste an existing ASCII-armored private key from
 *      another installation (account migration).
 *   - **"skip"**    — write the keystore with NO PGP key (just the
 *      access token). The user can come back to `/setup-key` later to
 *      generate or import one. Without a PGP key the app can show the
 *      chat list / send messages but cannot encrypt new outgoing
 *      messages — Composer will surface that clearly.
 *
 * Layout: centered, no sidebar / AppShell, no tabs (mode-switching is
 * done via a 3-button segmented control). Hard `replace` navigation
 * away from `/login` so back-button doesn't return to the (now-completed)
 * login form. On success → `/chats`.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Checkbox,
  Container,
  Group,
  Paper,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { IconKey, IconLock, IconShield } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { useSessionStore } from "@/features/auth/sessionStore";
import {
  createBareKeystore,
  generateAndStoreKey,
  importAndStoreKey,
} from "@/features/keyring/generate";
import { changePublicKey } from "@/features/auth/api";
import { toUserMessage } from "@/infra/error";
import type { KeyAlgorithm } from "@/features/keyring/types";

type PgpMode = "generate" | "import" | "skip";

export function CreateKeystoreRoute(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);

  // Keystore passphrase — required.
  const [keystorePass, setKeystorePass] = useState("");
  const [keystorePassConfirm, setKeystorePassConfirm] = useState("");

  // PGP mode + per-mode fields.
  const [pgpMode, setPgpMode] = useState<PgpMode>("generate");

  // Generate-mode fields.
  const [pgpHasOwnPassphrase, setPgpHasOwnPassphrase] = useState(false);
  const [pgpPass, setPgpPass] = useState("");
  const [pgpPassConfirm, setPgpPassConfirm] = useState("");
  const [algorithm, setAlgorithm] = useState<KeyAlgorithm>("ecc");

  // Import-mode fields.
  const [armoredPrivate, setArmoredPrivate] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetPgpFields(): void {
    setPgpHasOwnPassphrase(false);
    setPgpPass("");
    setPgpPassConfirm("");
    setArmoredPrivate("");
    setImportPassphrase("");
    setError(null);
  }

  function handleModeChange(value: string): void {
    setPgpMode(value as PgpMode);
    resetPgpFields();
  }

  function validateKeystorePass(): string | null {
    if (user === null) {
      return t("createKeystore.errors.noUser");
    }
    if (keystorePass.length === 0) {
      return t("createKeystore.errors.keystorePassphraseRequired");
    }
    if (keystorePass !== keystorePassConfirm) {
      return t("createKeystore.errors.keystorePassphrasesMismatch");
    }
    return null;
  }

  async function handleGenerate(u: NonNullable<typeof user>): Promise<string | null> {
    // PGP passphrase is optional; when the checkbox is on, the two
    // fields must match and be non-empty.
    let pgpPassphrase: string | undefined;
    if (pgpHasOwnPassphrase) {
      if (pgpPass.length === 0) {
        return t("createKeystore.errors.pgpPassphraseEmpty");
      }
      if (pgpPass !== pgpPassConfirm) {
        return t("createKeystore.errors.pgpPassphrasesMismatch");
      }
      pgpPassphrase = pgpPass;
    } else {
      // undefined → fall back to keystore passphrase inside
      // `generateAndStoreKey`. Empty string would mean "no PGP passphrase",
      // which the user did not opt into via the segmented control.
      pgpPassphrase = undefined;
    }
    const pair = await generateAndStoreKey(u.email, keystorePass, pgpPassphrase, algorithm);
    await changePublicKey(pair.publicKeyArmored);
    return null;
  }

  async function handleImport(u: NonNullable<typeof user>): Promise<string | null> {
    if (!armoredPrivate.includes("BEGIN PGP PRIVATE KEY BLOCK")) {
      return t("createKeystore.errors.importInvalidArmor");
    }
    if (importPassphrase.length === 0) {
      return t("createKeystore.errors.importPassphraseRequired");
    }
    // The private block usually embeds the public component, so try
    // splitting on the public block marker; fall back to an empty
    // public block if missing (keyring.importPrivateKey will surface a
    // useful error if the armored string is truly malformed).
    const splitMarker = "-----BEGIN PGP PUBLIC KEY BLOCK-----";
    const privatePart = armoredPrivate.split(splitMarker)[0] ?? armoredPrivate;
    const publicPart = armoredPrivate.includes(splitMarker)
      ? `${splitMarker}${armoredPrivate.split(splitMarker)[1] ?? ""}`
      : "";
    await importAndStoreKey(privatePart, publicPart, importPassphrase, u.email);
    // Push the imported public key to the server so peers can find us.
    try {
      await changePublicKey(publicPart.length > 0 ? publicPart : "");
    } catch {
      // Non-fatal: the import succeeded locally; the server registration
      // can be retried later via /setup-key Share tab.
    }
    return null;
  }

  async function handleSkip(u: NonNullable<typeof user>): Promise<string | null> {
    await createBareKeystore(u.email, keystorePass);
    return null;
  }

  async function handleSubmit(): Promise<void> {
    setError(null);
    const v = validateKeystorePass();
    if (v !== null) {
      setError(v);
      return;
    }
    if (user === null) {
      setError(t("createKeystore.errors.noUser"));
      return;
    }
    const u = user;
    setBusy(true);
    try {
      let modeError: string | null = null;
      if (pgpMode === "generate") {
        modeError = await handleGenerate(u);
      } else if (pgpMode === "import") {
        modeError = await handleImport(u);
      } else {
        modeError = await handleSkip(u);
      }
      if (modeError !== null) {
        setError(modeError);
        return;
      }
      navigate("/chats", { replace: true });
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" p="md">
      <Container size="sm" w="100%">
        <Paper p="xl" withBorder shadow="md">
          <Stack gap="md">
            <Group justify="center">
              <IconShield size={48} />
            </Group>
            <Title order={2} ta="center">
              {t("createKeystore.title")}
            </Title>
            <Text c="dimmed" ta="center" size="sm">
              {t("createKeystore.description")}
            </Text>

            <Title order={4} mt="sm">
              <Group gap="xs">
                <IconLock size={18} />
                <span>{t("createKeystore.keystoreSection")}</span>
              </Group>
            </Title>
            <Alert color="yellow" icon={<IconLock size={16} />}>
              {t("createKeystore.keystoreWarning")}
            </Alert>
            <PasswordInput
              label={t("createKeystore.keystorePassphrase")}
              placeholder={t("createKeystore.keystorePassphrasePlaceholder")}
              value={keystorePass}
              onChange={(e) => setKeystorePass(e.currentTarget.value)}
              autoFocus
            />
            <PasswordInput
              label={t("createKeystore.keystorePassphraseConfirm")}
              value={keystorePassConfirm}
              onChange={(e) => setKeystorePassConfirm(e.currentTarget.value)}
            />

            <Title order={4} mt="sm">
              <Group gap="xs">
                <IconKey size={18} />
                <span>{t("createKeystore.pgpSection")}</span>
              </Group>
            </Title>
            <Text size="xs" c="dimmed">
              {t("createKeystore.pgpDescription")}
            </Text>
            <SegmentedControl
              value={pgpMode}
              onChange={handleModeChange}
              data={[
                { value: "generate", label: t("createKeystore.modeGenerate") },
                { value: "import", label: t("createKeystore.modeImport") },
                { value: "skip", label: t("createKeystore.modeSkip") },
              ]}
              fullWidth
            />

            {pgpMode === "generate" && (
              <Stack gap="sm">
                <Checkbox
                  label={t("createKeystore.pgpSeparatePassphrase")}
                  checked={pgpHasOwnPassphrase}
                  onChange={(e) => setPgpHasOwnPassphrase(e.currentTarget.checked)}
                />
                {pgpHasOwnPassphrase && (
                  <>
                    <PasswordInput
                      label={t("createKeystore.pgpPassphrase")}
                      value={pgpPass}
                      onChange={(e) => setPgpPass(e.currentTarget.value)}
                    />
                    <PasswordInput
                      label={t("createKeystore.pgpPassphraseConfirm")}
                      value={pgpPassConfirm}
                      onChange={(e) => setPgpPassConfirm(e.currentTarget.value)}
                    />
                  </>
                )}
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    {t("createKeystore.algorithm")}
                  </Text>
                  <SegmentedControl
                    value={algorithm}
                    onChange={(v) => setAlgorithm(v as KeyAlgorithm)}
                    data={[
                      { value: "ecc", label: "ECC (Curve25519)" },
                      { value: "rsa", label: "RSA 4096" },
                    ]}
                    fullWidth
                  />
                  <Text size="xs" c="dimmed">
                    {t("createKeystore.algorithmHelp")}
                  </Text>
                </Stack>
              </Stack>
            )}

            {pgpMode === "import" && (
              <Stack gap="sm">
                <Textarea
                  label={t("createKeystore.importArmoredLabel")}
                  placeholder={t("createKeystore.importArmoredPlaceholder")}
                  value={armoredPrivate}
                  onChange={(e) => setArmoredPrivate(e.currentTarget.value)}
                  autosize
                  minRows={6}
                  maxRows={12}
                />
                <PasswordInput
                  label={t("createKeystore.importPassphraseLabel")}
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.currentTarget.value)}
                />
              </Stack>
            )}

            {pgpMode === "skip" && (
              <Alert color="gray" icon={<IconKey size={16} />}>
                {t("createKeystore.skipDescription")}
              </Alert>
            )}

            {error !== null && <Alert color="red">{error}</Alert>}

            <Button
              onClick={() => void handleSubmit()}
              loading={busy}
              disabled={keystorePass.length === 0 || keystorePassConfirm.length === 0}
              size="md"
              fullWidth
            >
              {t("createKeystore.submit")}
            </Button>
          </Stack>
        </Paper>
      </Container>
    </Center>
  );
}
