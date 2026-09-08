/**
 * Onboarding route for first-time PGP key setup.
 *
 * Three tabs, one per flow described in `docs/design.md` §9.2:
 *   - **Generate** — create a fresh ECC key, persist to keystore, push
 *     public key to the server, redirect to `/chats`.
 *   - **Import**   — paste an existing armored private key, unlock with
 *     its passphrase, persist, redirect.
 *   - **Export**   — write the current keystore to a user-chosen
 *     `.qks.json` file as a manual backup.
 *
 * Progress feedback on the Generate tab is a coarse 20/80/100 bar:
 * generation is local and blocking, but the network upload is what
 * actually wants visibility, so the bar advances on each major step.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Code,
  Paper,
  PasswordInput,
  Progress,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import { useSessionStore } from "@/features/auth/sessionStore";
import { generateAndStoreKey, importAndStoreKey, exportKeystoreToFile } from "@/features/keyring/generate";
import { changePublicKey } from "@/features/auth/api";
import { toUserMessage } from "@/infra/error";

export function SetupKeyRoute(): JSX.Element {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const [tab, setTab] = useState<string | null>("generate");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [armored, setArmored] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleGenerate(): Promise<void> {
    setError(null);
    if (passphrase.length < 8) {
      setError("Passphrase must be at least 8 characters");
      return;
    }
    if (passphrase !== confirm) {
      setError("Passphrases don't match");
      return;
    }
    if (user === null) {
      setError("No user");
      return;
    }
    setBusy(true);
    setProgress(20);
    try {
      const pair = await generateAndStoreKey(user.email, passphrase);
      setProgress(80);
      await changePublicKey(pair.publicKeyArmored);
      setProgress(100);
      navigate("/chats", { replace: true });
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(): Promise<void> {
    setError(null);
    if (!armored.includes("BEGIN PGP PRIVATE KEY")) {
      setError("Not a valid private key");
      return;
    }
    if (passphrase.length < 1) {
      setError("Passphrase required");
      return;
    }
    if (user === null) {
      setError("No user");
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
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(): Promise<void> {
    setError(null);
    setSuccess(null);
    try {
      const path = await exportKeystoreToFile(passphrase);
      if (path !== null) {
        setSuccess(`Saved to ${path}`);
      }
    } catch (e) {
      setError(toUserMessage(e));
    }
  }

  return (
    <Paper p="md" maw={600} mx="auto" mt={40}>
      <Title order={2} mb="md">
        Setup your encryption key
      </Title>
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="generate">Generate new</Tabs.Tab>
          <Tabs.Tab value="import">Import existing</Tabs.Tab>
          <Tabs.Tab value="export">Export keystore</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="generate" pt="md">
          <Stack>
            <Text size="sm">
              Generate a new PGP key pair. The private key is stored encrypted on your device.
              The public key is uploaded to the server.
            </Text>
            <PasswordInput
              label="Passphrase (min 8 chars)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.currentTarget.value)}
            />
            <PasswordInput
              label="Confirm passphrase"
              value={confirm}
              onChange={(e) => setConfirm(e.currentTarget.value)}
            />
            {progress > 0 && <Progress value={progress} />}
            {error !== null && <Alert color="red">{error}</Alert>}
            <Button onClick={() => void handleGenerate()} loading={busy}>
              Generate and continue
            </Button>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="import" pt="md">
          <Stack>
            <Text size="sm">Paste your ASCII-armored PGP private key:</Text>
            <TextInput
              label="Armored key"
              value={armored}
              onChange={(e) => setArmored(e.currentTarget.value)}
              placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----"
            />
            <PasswordInput
              label="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.currentTarget.value)}
            />
            {error !== null && <Alert color="red">{error}</Alert>}
            <Button onClick={() => void handleImport()} loading={busy}>
              Import and continue
            </Button>
            <Code block fz="xs">
              Tip: the block may also contain a public key section — it&apos;s used as-is when present.
            </Code>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="export" pt="md">
          <Stack>
            <Text size="sm">Export your encrypted keystore as a .qks.json file for backup:</Text>
            <PasswordInput
              label="Passphrase (to verify)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.currentTarget.value)}
            />
            {error !== null && <Alert color="red">{error}</Alert>}
            {success !== null && <Alert color="green">{success}</Alert>}
            <Button onClick={() => void handleExport()}>Export keystore</Button>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
