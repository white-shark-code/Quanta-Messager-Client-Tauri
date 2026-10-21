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
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import {
  Alert,
  Button,
  Center,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { hasKeystore } from "@/infra/tauriBridge";
import { getOnboardingPending } from "@/features/auth/onboardingPending";
import { useSessionStore } from "@/features/auth/sessionStore";
import { unlockWithPassphrase } from "@/features/auth/unlock";
import { wipeDeviceData } from "@/features/settings/wipeLocalData";
import { toUserMessage } from "@/infra/error";

/**
 * Extract a safe post-unlock target from `location.state`.
 * Accepts `state.from` either as a plain string or as a location-like
 * `{ pathname }`. Only same-origin absolute paths are allowed, and
 * auth endpoints (`/login`, `/unlock`) plus bare `/` fall back to
 * `/chats` to avoid redirect loops.
 */
function resolvePostUnlockTarget(state: unknown): string {
  let pathname: unknown;
  if (typeof state === "object" && state !== null && "from" in state) {
    const from = (state as { from?: unknown }).from;
    if (typeof from === "string") {
      pathname = from;
    } else if (typeof from === "object" && from !== null && "pathname" in from) {
      pathname = (from as { pathname?: unknown }).pathname;
    }
  }
  if (typeof pathname !== "string" || !pathname.startsWith("/")) {
    return "/chats";
  }
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/login?") ||
    pathname === "/unlock" ||
    pathname.startsWith("/unlock/") ||
    pathname.startsWith("/unlock?")
  ) {
    return "/chats";
  }
  return pathname;
}

export function UnlockRoute(): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const userId = searchParams.get("userId");

  const [hasKs, setHasKs] = useState<boolean | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [pgpDiffers, setPgpDiffers] = useState(false);
  const [pgpPassphrase, setPgpPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wipeOpened, { open: wipeOpen, close: wipeClose }] = useDisclosure(false);

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
      await unlockWithPassphrase(userId, passphrase, pgpDiffers ? pgpPassphrase : undefined);
      // Bare keystore (no PGP key) + unfinished onboarding: the user
      // never completed key generation — resume it instead of chats.
      // We can only see the `NO_KEY` sentinel AFTER decryption, which
      // is why this check lives here and not in the pre-unlock guards.
      const fingerprint = useSessionStore.getState().fingerprint;
      if (fingerprint === "NO_KEY" && getOnboardingPending() !== null) {
        navigate(`/create-keystore?userId=${encodeURIComponent(userId)}&resume=1`, {
          replace: true,
        });
        return;
      }
      navigate(resolvePostUnlockTarget(location.state), { replace: true });
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Wipe device data from the unlock screen: the user cannot remember
   * the passphrase, so every local artifact (dialogs, media vault,
   * keystore) is erased and the session starts from /login. Nothing is
   * unlocked here, hence no RAM caches to clear.
   */
  async function handleWipe(): Promise<void> {
    if (userId === null) return;
    try {
      await wipeDeviceData(userId);
    } catch {
      // best-effort
    }
    setPassphrase("");
    setPgpPassphrase("");
    setPgpDiffers(false);
    wipeClose();
    // Keystore is gone → the unlock screen can no longer offer unlock.
    navigate("/login", { replace: true });
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
              <Button type="submit" loading={busy} disabled={passphrase.length === 0} fullWidth>
                {t("auth.unlock.submit")}
              </Button>
            </Stack>
          </form>
          <Button variant="subtle" color="red" size="compact-sm" onClick={wipeOpen}>
            {t("unlock.wipeDataButton")}
          </Button>
        </Stack>
      </Paper>
      <Modal
        opened={wipeOpened}
        onClose={wipeClose}
        title={t("unlock.wipeDataConfirmTitle")}
        centered
      >
        <Stack>
          <Text size="sm">{t("unlock.wipeDataConfirmText")}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={wipeClose}>
              {t("common.cancel")}
            </Button>
            <Button color="red" onClick={() => void handleWipe()}>
              {t("unlock.wipeDataAction")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Center>
  );
}
