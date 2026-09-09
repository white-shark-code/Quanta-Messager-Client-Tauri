/**
 * Unlock route — shown on app start if a keystore already exists on disk.
 *
 * Flow:
 * 1. Probe `hasKeystore()` — if no keystore file, redirect to /login
 * 2. Otherwise render a single passphrase input and "Unlock" button
 * 3. On submit, call `unlockWithPassphrase()` which reads the keystore,
 *    imports the PGP keys into keyringStore, sets session.user and the
 *    bearer token. On success navigate to /chats.
 *
 * NOT protected by RequireAuth — anyone with access to the disk can
 * already read the keystore file; the passphrase is the second factor.
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Checkbox,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { hasKeystore } from "@/infra/tauriBridge";
import { unlockWithPassphrase } from "@/features/auth/unlock";
import { toUserMessage } from "@/infra/error";

export function UnlockRoute(): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const userId = searchParams.get("userId");

  const [hasKs, setHasKs] = useState<boolean | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [pgpDiffers, setPgpDiffers] = useState(false);
  const [pgpPassphrase, setPgpPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (userId === null) {
      navigate("/login", { replace: true });
    }
  }, [userId, navigate]);

  useEffect(() => {
    if (userId === null) return;
    void hasKeystore(userId).then(setHasKs);
  }, [userId]);

  useEffect(() => {
    if (hasKs === false) {
      navigate("/login", { replace: true });
    }
  }, [hasKs, navigate]);

  async function handleUnlock(): Promise<void> {
    if (userId === null) return;
    setError(null);
    setBusy(true);
    try {
      await unlockWithPassphrase(
        userId,
        passphrase,
        pgpDiffers ? pgpPassphrase : undefined,
      );
      navigate("/chats", { replace: true });
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (userId === null) {
    return null;
  }
  if (hasKs === null) {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  }
  if (hasKs === false) {
    return null;
  }

  return (
    <Center mih="100vh">
      <Paper p="xl" maw={420} w="100%" withBorder>
        <Stack>
          <Center>
            <IconLock size={48} />
          </Center>
          <Title order={2} ta="center">
            {t("unlock.title")}
          </Title>
          <Text c="dimmed" ta="center" size="sm">
            {t("unlock.description")}
          </Text>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleUnlock();
            }}
          >
            <Stack>
              <PasswordInput
                label={t("auth.unlock.passphrase")}
                placeholder={t("unlock.placeholder")}
                value={passphrase}
                onChange={(e) => setPassphrase(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleUnlock();
                  }
                }}
                autoFocus
              />
              <Checkbox
                label={t("auth.unlock.pgpDiffers")}
                checked={pgpDiffers}
                onChange={(e) => setPgpDiffers(e.currentTarget.checked)}
              />
              {pgpDiffers && (
                <PasswordInput
                  label={t("auth.unlock.pgpPassphrase")}
                  value={pgpPassphrase}
                  onChange={(e) => setPgpPassphrase(e.currentTarget.value)}
                />
              )}
              {error !== null && <Alert color="red">{error}</Alert>}
              <Button
                type="submit"
                loading={busy}
                disabled={passphrase.length === 0}
                fullWidth
              >
                {t("auth.unlock.submit")}
              </Button>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Center>
  );
}
