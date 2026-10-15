/**
 * Unlock-again modal — re-prompt for the keystore passphrase, with the
 * server password only as a second step (T3 unlock-first).
 *
 * Layout:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [x] Keystore passphrase           (always shown)     │
 *   │ [ ] PGP passphrase differs        (opt-in checkbox)  │
 *   │     └ PGP passphrase             (only if checked)   │
 *   │ Email (locked to owner)           (read-only)        │
 *   │ Server password                   (optional re-auth) │
 *   │ [Unlock]  or  [Unlock & re-authorize]                │
 *   └──────────────────────────────────────────────────────┘
 *
 * Behaviour (unlock-first):
 *   - Submit with an EMPTY server password → `unlockWithPassphrase`
 *     (no server round-trip), then a probe `authApi.me()`. Success →
 *     reset + close. 401 → do NOT close; instead set `needsReauth` and
 *     reveal the server-password hint so the user retries WITH the
 *     server password.
 *   - Submit with a FILLED server password (right away, or after the
 *     401 hint) → `reauth({ userId, email, ... })` which logs in
 *     against `/auth/login`, persists the fresh bearer into the
 *     keystore and refreshes `apiClient`. Then reset + close.
 *   - Any other failure → error alert, form state (passphrases) kept.
 *
 * Identity chain: `sessionStore.user` (retained across soft lock) ??
 * `getLastUserId()` + email looked up from `readIndex()`. The email is
 * read-only — each keystore belongs to exactly one user, and a typo
 * would otherwise let the user re-authorize as a *different* account
 * and quietly re-encrypt their own keystore with a foreign bearer.
 *
 * When no identity resolves at all (empty index) the modal shows a
 * "log in again" hint plus a close button instead of throwing — the
 * modal is mounted globally in `main.tsx` where no router `navigate`
 * is available, so we never link to `/login` from here.
 *
 * PGP passphrase defaults to the keystore passphrase when the checkbox
 * is off — the typical case ("one passphrase for everything") needs no
 * extra UI.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Modal,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";

import { useSessionStore } from "@/features/auth/sessionStore";
import { router } from "@/routes";
import {
  resolveIndexIdentity,
  submitUnlockAgain,
  type UnlockAgainIdentity,
} from "@/features/auth/unlockAgain";
import { getLastUserId, readIndex } from "@/features/secure-store/store";
import { toUserMessage } from "@/infra/error";

import { useUnlockModal } from "./useUnlockModal";

function UnlockModalTrigger({ onTrigger }: { onTrigger: () => void }): null {
  useUnlockModal(onTrigger);
  return null;
}

export function UnlockAgainModal(): JSX.Element {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const sessionUser = useSessionStore((s) => s.user);
  const [indexIdentity, setIndexIdentity] = useState<UnlockAgainIdentity | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [pgpDiffers, setPgpDiffers] = useState(false);
  const [pgpPassphrase, setPgpPassphrase] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [needsReauth, setNeedsReauth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fallback identity for the case where the session store has no user
  // (e.g. after a hard logout path): most-recent keystore owner from
  // the unencrypted index. Resolved lazily on open, not on mount.
  useEffect(() => {
    if (!opened || sessionUser !== null) {
      return;
    }
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const [uid, idx] = await Promise.all([getLastUserId(), readIndex()]);
        if (!cancelled) {
          setIndexIdentity(resolveIndexIdentity(idx.users, uid));
        }
      } catch {
        if (!cancelled) {
          setIndexIdentity(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, sessionUser]);

  const identity: UnlockAgainIdentity | null =
    sessionUser !== null ? { userId: sessionUser.id, email: sessionUser.email } : indexIdentity;

  // Server password is optional: plain unlock is attempted first.
  const canSubmit =
    identity !== null && passphrase.length > 0 && (!pgpDiffers || pgpPassphrase.length > 0);
  const wantsReauth = serverPassword.length > 0 || needsReauth;

  function reset(): void {
    setPassphrase("");
    setPgpDiffers(false);
    setPgpPassphrase("");
    setServerPassword("");
    setNeedsReauth(false);
    setError(null);
    setIndexIdentity(null);
  }

  async function handleSubmit(): Promise<void> {
    if (identity === null) {
      setError(t("auth.unlock.noIdentity"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const outcome = await submitUnlockAgain({
        identity,
        keystorePassphrase: passphrase,
        ...(pgpDiffers ? { pgpPassphrase } : {}),
        serverPassword,
      });
      if (outcome.kind === "needsReauth") {
        // Token rejected server-side: keep the typed passphrases and
        // ask for the server password instead of closing.
        setNeedsReauth(true);
        return;
      }
      reset();
      close();
      // The 401 that opened this modal also soft-locked the session,
      // so RequireAuth may have parked the page on /unlock or /login
      // underneath us. The session is fully restored now (keys in
      // memory + fresh bearer), so leave the auth pages instead of
      // asking for the passphrase a second time. The modal lives
      // outside <RouterProvider> (see main.tsx), hence the imperative
      // `router.navigate` instead of `useNavigate`.
      const path = window.location.pathname;
      if (path === "/unlock" || path.startsWith("/unlock?") || path.startsWith("/login")) {
        await router.navigate("/chats", { replace: true });
      }
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={close}
        title={t("auth.unlock.title")}
        centered
        onExitTransitionEnd={reset}
      >
        {identity === null ? (
          <Stack>
            <Text size="sm">{t("auth.unlock.description")}</Text>
            <Alert color="red">{t("auth.unlock.noIdentity")}</Alert>
            {error !== null && <Alert color="red">{error}</Alert>}
            <Button onClick={close} variant="default">
              {t("common.cancel")}
            </Button>
          </Stack>
        ) : (
          <Stack>
            <Text size="sm">{t("auth.unlock.description")}</Text>

            <PasswordInput
              label={t("auth.unlock.passphrase")}
              placeholder={t("unlock.placeholder")}
              value={passphrase}
              onChange={(e) => setPassphrase(e.currentTarget.value)}
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

            <Divider label={t("auth.unlock.reauthDivider")} labelPosition="center" />

            <Text size="xs" c="dimmed">
              {t("auth.unlock.reauthHint")}
            </Text>

            <TextInput
              label={t("auth.email")}
              value={identity.email}
              disabled
              description={t("auth.unlock.emailLocked")}
            />

            {needsReauth && <Alert color="yellow">{t("auth.unlock.reauthNeeded")}</Alert>}

            <PasswordInput
              label={t("auth.login.password")}
              value={serverPassword}
              onChange={(e) => setServerPassword(e.currentTarget.value)}
              autoComplete="current-password"
            />

            {error !== null && <Alert color="red">{error}</Alert>}

            <Button onClick={() => void handleSubmit()} loading={busy} disabled={!canSubmit}>
              {wantsReauth ? t("auth.unlock.submitReauth") : t("auth.unlock.submit")}
            </Button>
          </Stack>
        )}
      </Modal>
      <UnlockModalTrigger onTrigger={open} />
    </>
  );
}
