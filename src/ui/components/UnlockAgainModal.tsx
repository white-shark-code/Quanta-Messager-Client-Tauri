import { useState } from "react";
import { Alert, Button, Modal, PasswordInput, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";

import { unlockWithPassphrase } from "@/features/auth/unlock";
import { toUserMessage } from "@/infra/error";

import { useUnlockModal } from "./useUnlockModal";

function UnlockModalTrigger({ onTrigger }: { onTrigger: () => void }): null {
  useUnlockModal(onTrigger);
  return null;
}

export function UnlockAgainModal(): JSX.Element {
  const [opened, { open, close }] = useDisclosure(false);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleUnlock(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await unlockWithPassphrase(passphrase);
      setPassphrase("");
      close();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal opened={opened} onClose={close} title="Session expired" centered>
        <Stack>
          <Text size="sm">Your session expired. Enter your keystore passphrase to continue.</Text>
          <PasswordInput
            label="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) {
                e.preventDefault();
                void handleUnlock();
              }
            }}
          />
          {error && <Alert color="red">{error}</Alert>}
          <Button onClick={() => void handleUnlock()} loading={busy}>
            Unlock
          </Button>
        </Stack>
      </Modal>
      <UnlockModalTrigger onTrigger={open} />
    </>
  );
}
