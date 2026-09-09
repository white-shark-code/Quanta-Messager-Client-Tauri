import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Unlock-again modal — re-prompt for the keystore passphrase and (if
 * needed) a server re-login when the bearer is rejected with 401.
 *
 * Layout:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [x] Keystore passphrase           (always shown)     │
 *   │ [ ] PGP passphrase differs        (opt-in checkbox)  │
 *   │     └ PGP passphrase             (only if checked)   │
 *   │ Email (locked to session)         (read-only)        │
 *   │ Server password                   (optional re-auth) │
 *   │ [Unlock]  or  [Unlock & re-authorize]                │
 *   └──────────────────────────────────────────────────────┘
 *
 * Behaviour:
 *   - If `serverPassword` is filled → call `reauth({userId, ...})`
 *     which logs in against `/auth/login` (using the email from
 *     `sessionStore.user.email`), updates the token in the keystore,
 *     and refreshes `apiClient`. The userId is sourced from the
 *     session store so the keystore re-encrypt targets the right file.
 *   - Otherwise → call `unlockWithPassphrase(userId, pass, pgpPass?)`
 *     which only re-loads the keys + bearer from the on-disk keystore
 *     (no server round-trip).
 *
 * The email is read-only — in a multi-user environment each keystore
 * belongs to exactly one user, and a typo in the email field would
 * otherwise let the user re-authorize as a *different* account and
 * quietly re-encrypt their own keystore with a foreign bearer. The
 * server password alone is sufficient to express "re-auth this user";
 * the email is locked to `sessionStore.user.email`.
 *
 * PGP passphrase defaults to the keystore passphrase when the checkbox
 * is off — the typical case ("one passphrase for everything") needs no
 * extra UI.
 */
import { useState } from "react";
import { Alert, Button, Checkbox, Divider, Modal, PasswordInput, Stack, Text, TextInput, } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { reauth } from "@/features/auth/reauth";
import { useSessionStore } from "@/features/auth/sessionStore";
import { unlockWithPassphrase } from "@/features/auth/unlock";
import { toUserMessage } from "@/infra/error";
import { useUnlockModal } from "./useUnlockModal";
function UnlockModalTrigger({ onTrigger }) {
    useUnlockModal(onTrigger);
    return null;
}
export function UnlockAgainModal() {
    const { t } = useTranslation();
    const [opened, { open, close }] = useDisclosure(false);
    const userEmail = useSessionStore((s) => s.user?.email ?? "");
    const [passphrase, setPassphrase] = useState("");
    const [pgpDiffers, setPgpDiffers] = useState(false);
    const [pgpPassphrase, setPgpPassphrase] = useState("");
    const [serverPassword, setServerPassword] = useState("");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const wantsReauth = serverPassword.length > 0;
    const canSubmit = passphrase.length > 0 &&
        (!pgpDiffers || pgpPassphrase.length > 0) &&
        serverPassword.length > 0;
    function reset() {
        setPassphrase("");
        setPgpDiffers(false);
        setPgpPassphrase("");
        setServerPassword("");
        setError(null);
    }
    async function handleSubmit() {
        setError(null);
        setBusy(true);
        try {
            if (wantsReauth) {
                const uid = useSessionStore.getState().user?.id;
                if (uid === undefined) {
                    throw new Error("unlock-again: no userId in sessionStore");
                }
                await reauth({
                    userId: uid,
                    keystorePassphrase: passphrase,
                    ...(pgpDiffers ? { pgpPassphrase } : {}),
                    serverPassword,
                });
            }
            else {
                const uid = useSessionStore.getState().user?.id;
                if (uid === undefined) {
                    throw new Error("unlock-again: no userId in sessionStore");
                }
                await unlockWithPassphrase(uid, passphrase, pgpDiffers ? pgpPassphrase : undefined);
            }
            reset();
            close();
        }
        catch (e) {
            setError(toUserMessage(e));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs(_Fragment, { children: [_jsx(Modal, { opened: opened, onClose: close, title: t("auth.unlock.title"), centered: true, onExitTransitionEnd: reset, children: _jsxs(Stack, { children: [_jsx(Text, { size: "sm", children: t("auth.unlock.description") }), _jsx(PasswordInput, { label: t("auth.unlock.passphrase"), placeholder: t("unlock.placeholder"), value: passphrase, onChange: (e) => setPassphrase(e.currentTarget.value), autoFocus: true }), _jsx(Checkbox, { label: t("auth.unlock.pgpDiffers"), checked: pgpDiffers, onChange: (e) => setPgpDiffers(e.currentTarget.checked) }), pgpDiffers && (_jsx(PasswordInput, { label: t("auth.unlock.pgpPassphrase"), value: pgpPassphrase, onChange: (e) => setPgpPassphrase(e.currentTarget.value) })), _jsx(Divider, { label: t("auth.unlock.reauthDivider"), labelPosition: "center" }), _jsx(Text, { size: "xs", c: "dimmed", children: t("auth.unlock.reauthHint") }), _jsx(TextInput, { label: t("auth.email"), value: userEmail, disabled: true, description: t("auth.unlock.emailLocked") }), _jsx(PasswordInput, { label: t("auth.password"), value: serverPassword, onChange: (e) => setServerPassword(e.currentTarget.value), autoComplete: "current-password" }), error !== null && _jsx(Alert, { color: "red", children: error }), _jsx(Button, { onClick: () => void handleSubmit(), loading: busy, disabled: !canSubmit, children: wantsReauth
                                ? t("auth.unlock.submitReauth")
                                : t("auth.unlock.submit") })] }) }), _jsx(UnlockModalTrigger, { onTrigger: open })] }));
}
