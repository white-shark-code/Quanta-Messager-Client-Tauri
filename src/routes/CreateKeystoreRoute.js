import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { Alert, Button, Center, Checkbox, Container, Group, Paper, PasswordInput, SegmentedControl, Stack, Text, Textarea, Title, } from "@mantine/core";
import { IconKey, IconLock, IconShield } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/features/auth/sessionStore";
import { createBareKeystore, generateAndStoreKey, importAndStoreKey, } from "@/features/keyring/generate";
import { changePublicKey } from "@/features/auth/api";
import { toUserMessage } from "@/infra/error";
export function CreateKeystoreRoute() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const user = useSessionStore((s) => s.user);
    // Keystore passphrase — required.
    const [keystorePass, setKeystorePass] = useState("");
    const [keystorePassConfirm, setKeystorePassConfirm] = useState("");
    // PGP mode + per-mode fields.
    const [pgpMode, setPgpMode] = useState("generate");
    // Generate-mode fields.
    const [pgpHasOwnPassphrase, setPgpHasOwnPassphrase] = useState(false);
    const [pgpPass, setPgpPass] = useState("");
    const [pgpPassConfirm, setPgpPassConfirm] = useState("");
    const [algorithm, setAlgorithm] = useState("ecc");
    // Import-mode fields.
    const [armoredPrivate, setArmoredPrivate] = useState("");
    const [importPassphrase, setImportPassphrase] = useState("");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    function resetPgpFields() {
        setPgpHasOwnPassphrase(false);
        setPgpPass("");
        setPgpPassConfirm("");
        setArmoredPrivate("");
        setImportPassphrase("");
        setError(null);
    }
    function handleModeChange(value) {
        setPgpMode(value);
        resetPgpFields();
    }
    function validateKeystorePass() {
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
    async function handleGenerate(u) {
        // PGP passphrase is optional; when the checkbox is on, the two
        // fields must match and be non-empty.
        let pgpPassphrase;
        if (pgpHasOwnPassphrase) {
            if (pgpPass.length === 0) {
                return t("createKeystore.errors.pgpPassphraseEmpty");
            }
            if (pgpPass !== pgpPassConfirm) {
                return t("createKeystore.errors.pgpPassphrasesMismatch");
            }
            pgpPassphrase = pgpPass;
        }
        else {
            // undefined → fall back to keystore passphrase inside
            // `generateAndStoreKey`. Empty string would mean "no PGP passphrase",
            // which the user did not opt into via the segmented control.
            pgpPassphrase = undefined;
        }
        const pair = await generateAndStoreKey(u.email, keystorePass, pgpPassphrase, algorithm);
        await changePublicKey(pair.publicKeyArmored);
        return null;
    }
    async function handleImport(u) {
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
        }
        catch {
            // Non-fatal: the import succeeded locally; the server registration
            // can be retried later via /setup-key Share tab.
        }
        return null;
    }
    async function handleSkip(u) {
        await createBareKeystore(u.email, keystorePass);
        return null;
    }
    async function handleSubmit() {
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
            let modeError = null;
            if (pgpMode === "generate") {
                modeError = await handleGenerate(u);
            }
            else if (pgpMode === "import") {
                modeError = await handleImport(u);
            }
            else {
                modeError = await handleSkip(u);
            }
            if (modeError !== null) {
                setError(modeError);
                return;
            }
            navigate("/chats", { replace: true });
        }
        catch (e) {
            setError(toUserMessage(e));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx(Center, { mih: "100vh", p: "md", children: _jsx(Container, { size: "sm", w: "100%", children: _jsx(Paper, { p: "xl", withBorder: true, shadow: "md", children: _jsxs(Stack, { gap: "md", children: [_jsx(Group, { justify: "center", children: _jsx(IconShield, { size: 48 }) }), _jsx(Title, { order: 2, ta: "center", children: t("createKeystore.title") }), _jsx(Text, { c: "dimmed", ta: "center", size: "sm", children: t("createKeystore.description") }), _jsx(Title, { order: 4, mt: "sm", children: _jsxs(Group, { gap: "xs", children: [_jsx(IconLock, { size: 18 }), _jsx("span", { children: t("createKeystore.keystoreSection") })] }) }), _jsx(Alert, { color: "yellow", icon: _jsx(IconLock, { size: 16 }), children: t("createKeystore.keystoreWarning") }), _jsx(PasswordInput, { label: t("createKeystore.keystorePassphrase"), placeholder: t("createKeystore.keystorePassphrasePlaceholder"), value: keystorePass, onChange: (e) => setKeystorePass(e.currentTarget.value), autoFocus: true }), _jsx(PasswordInput, { label: t("createKeystore.keystorePassphraseConfirm"), value: keystorePassConfirm, onChange: (e) => setKeystorePassConfirm(e.currentTarget.value) }), _jsx(Title, { order: 4, mt: "sm", children: _jsxs(Group, { gap: "xs", children: [_jsx(IconKey, { size: 18 }), _jsx("span", { children: t("createKeystore.pgpSection") })] }) }), _jsx(Text, { size: "xs", c: "dimmed", children: t("createKeystore.pgpDescription") }), _jsx(SegmentedControl, { value: pgpMode, onChange: handleModeChange, data: [
                                { value: "generate", label: t("createKeystore.modeGenerate") },
                                { value: "import", label: t("createKeystore.modeImport") },
                                { value: "skip", label: t("createKeystore.modeSkip") },
                            ], fullWidth: true }), pgpMode === "generate" && (_jsxs(Stack, { gap: "sm", children: [_jsx(Checkbox, { label: t("createKeystore.pgpSeparatePassphrase"), checked: pgpHasOwnPassphrase, onChange: (e) => setPgpHasOwnPassphrase(e.currentTarget.checked) }), pgpHasOwnPassphrase && (_jsxs(_Fragment, { children: [_jsx(PasswordInput, { label: t("createKeystore.pgpPassphrase"), value: pgpPass, onChange: (e) => setPgpPass(e.currentTarget.value) }), _jsx(PasswordInput, { label: t("createKeystore.pgpPassphraseConfirm"), value: pgpPassConfirm, onChange: (e) => setPgpPassConfirm(e.currentTarget.value) })] })), _jsxs(Stack, { gap: 4, children: [_jsx(Text, { size: "sm", fw: 500, children: t("createKeystore.algorithm") }), _jsx(SegmentedControl, { value: algorithm, onChange: (v) => setAlgorithm(v), data: [
                                                { value: "ecc", label: "ECC (Curve25519)" },
                                                { value: "rsa", label: "RSA 4096" },
                                            ], fullWidth: true }), _jsx(Text, { size: "xs", c: "dimmed", children: t("createKeystore.algorithmHelp") })] })] })), pgpMode === "import" && (_jsxs(Stack, { gap: "sm", children: [_jsx(Textarea, { label: t("createKeystore.importArmoredLabel"), placeholder: t("createKeystore.importArmoredPlaceholder"), value: armoredPrivate, onChange: (e) => setArmoredPrivate(e.currentTarget.value), autosize: true, minRows: 6, maxRows: 12 }), _jsx(PasswordInput, { label: t("createKeystore.importPassphraseLabel"), value: importPassphrase, onChange: (e) => setImportPassphrase(e.currentTarget.value) })] })), pgpMode === "skip" && (_jsx(Alert, { color: "gray", icon: _jsx(IconKey, { size: 16 }), children: t("createKeystore.skipDescription") })), error !== null && _jsx(Alert, { color: "red", children: error }), _jsx(Button, { onClick: () => void handleSubmit(), loading: busy, disabled: keystorePass.length === 0 || keystorePassConfirm.length === 0, size: "md", fullWidth: true, children: t("createKeystore.submit") })] }) }) }) }));
}
