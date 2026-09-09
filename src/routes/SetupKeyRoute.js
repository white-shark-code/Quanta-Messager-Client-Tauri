import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { Alert, Button, Checkbox, Code, CopyButton, Group, Paper, PasswordInput, Progress, ScrollArea, SegmentedControl, Stack, Tabs, Text, TextInput, Title, } from "@mantine/core";
import { IconCheck, IconCopy, IconDownload, IconEye, IconShieldLock, } from "@tabler/icons-react";
import { useSessionStore } from "@/features/auth/sessionStore";
import { generateAndStoreKey, importAndStoreKey, exportKeystoreToFile } from "@/features/keyring/generate";
import { changePublicKey } from "@/features/auth/api";
import { readKeystore } from "@/features/secure-store/store";
import { pickSaveFile, writeFileBuffer } from "@/infra/tauriBridge";
import { toUserMessage } from "@/infra/error";
import { debugLog, getDebugLogLocation } from "@/lib/debug";
function formatDebugForDisplay(err) {
    const info = {
        type: typeof err,
        constructor: err?.constructor?.name ?? "?",
        value: safeStr(err),
        stack: err instanceof Error ? err.stack : undefined,
    };
    return JSON.stringify(info, null, 2);
}
function safeStr(v) {
    try {
        return JSON.stringify(v, null, 2);
    }
    catch {
        return String(v);
    }
}
export function SetupKeyRoute() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const user = useSessionStore((s) => s.user);
    const [tab, setTab] = useState("generate");
    const [passphrase, setPassphrase] = useState("");
    const [confirm, setConfirm] = useState("");
    const [algorithm, setAlgorithm] = useState("ecc");
    const [armored, setArmored] = useState("");
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [busy, setBusy] = useState(false);
    const [rawError, setRawError] = useState(null);
    const [debugDetails, setDebugDetails] = useState("");
    const [debugLoc, setDebugLoc] = useState("");
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
    const [privateKeyArmored, setPrivateKeyArmored] = useState(null);
    useEffect(() => {
        return () => {
            setPrivateKeyArmored(null);
            setShareRevealed(false);
        };
    }, [tab]);
    async function handleGenerate() {
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
        }
        catch (e) {
            console.error("[Generate] error:", e, "type:", typeof e, "constructor:", e?.constructor?.name);
            void debugLog("Generate", e, { algorithm, hasUser: user !== null });
            setRawError(e);
            setDebugDetails(formatDebugForDisplay(e));
            setError(toUserMessage(e));
        }
        finally {
            setBusy(false);
        }
    }
    async function handleImport() {
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
        }
        catch (e) {
            void debugLog("Import", e, { hasUser: user !== null });
            setRawError(e);
            setDebugDetails(formatDebugForDisplay(e));
            setError(toUserMessage(e));
        }
        finally {
            setBusy(false);
        }
    }
    async function handleExport() {
        setError(null);
        setRawError(null);
        setDebugDetails("");
        setSuccess(null);
        try {
            const path = await exportKeystoreToFile(passphrase);
            if (path !== null) {
                setSuccess(t("setupKey.export.savedTo", { path }));
            }
        }
        catch (e) {
            void debugLog("Export", e);
            setRawError(e);
            setDebugDetails(formatDebugForDisplay(e));
            setError(toUserMessage(e));
        }
    }
    async function handleReveal() {
        setError(null);
        setRawError(null);
        setDebugDetails("");
        try {
            const keystore = await readKeystore(passphrase);
            setPrivateKeyArmored(keystore.privateKeyArmored);
            setShareRevealed(true);
        }
        catch (e) {
            void debugLog("Reveal", e);
            setRawError(e);
            setDebugDetails(formatDebugForDisplay(e));
            setError(toUserMessage(e));
        }
    }
    async function handleDownload() {
        if (privateKeyArmored === null)
            return;
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
            if (path === null)
                return;
            await writeFileBuffer(path, new TextEncoder().encode(privateKeyArmored));
            setSuccess(t("setupKey.export.savedTo", { path }));
        }
        catch (e) {
            void debugLog("Download", e);
            setRawError(e);
            setDebugDetails(formatDebugForDisplay(e));
            setError(toUserMessage(e));
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs(Paper, { p: "md", maw: 600, mx: "auto", mt: 40, children: [_jsx(Title, { order: 2, mb: "md", children: t("setupKey.title") }), _jsxs(Tabs, { value: tab, onChange: setTab, children: [_jsxs(Tabs.List, { children: [_jsx(Tabs.Tab, { value: "generate", children: t("setupKey.tabs.generate") }), _jsx(Tabs.Tab, { value: "import", children: t("setupKey.tabs.import") }), _jsx(Tabs.Tab, { value: "export", children: t("setupKey.tabs.export") }), _jsx(Tabs.Tab, { value: "share", children: t("setupKey.tabs.share") })] }), _jsx(Tabs.Panel, { value: "generate", pt: "md", children: _jsxs(Stack, { children: [_jsx(Text, { size: "sm", children: t("setupKey.generate.description") }), _jsx(Alert, { color: "yellow", children: t("setupKey.emptyPassphraseWarning") }), _jsx(PasswordInput, { label: t("setupKey.passphraseOptional"), value: passphrase, onChange: (e) => setPassphrase(e.currentTarget.value) }), _jsx(PasswordInput, { label: t("setupKey.passphraseOptional"), value: confirm, onChange: (e) => setConfirm(e.currentTarget.value) }), _jsxs(Stack, { gap: 4, children: [_jsx(Text, { size: "sm", fw: 500, children: t("setupKey.generate.algorithm") }), _jsx(SegmentedControl, { value: algorithm, onChange: (v) => setAlgorithm(v), data: [
                                                { value: "ecc", label: t("setupKey.generate.eccLabel") },
                                                { value: "rsa", label: t("setupKey.generate.rsaLabel") },
                                            ], fullWidth: true }), _jsx(Text, { size: "xs", c: "dimmed", children: t("setupKey.generate.algorithmHelp") })] }), progress > 0 && _jsx(Progress, { value: progress }), rawError !== null && (_jsxs(_Fragment, { children: [_jsx(Alert, { color: "red", children: error }), _jsxs("details", { style: { cursor: "pointer", marginTop: 4 }, children: [_jsxs("summary", { style: {
                                                        color: "var(--mantine-color-dimmed)",
                                                        fontSize: "0.85em",
                                                        padding: "4px 0",
                                                    }, children: ["\uD83D\uDD0D Debug info \u2014 log: ", debugLoc] }), _jsx(Code, { block: true, fz: "xs", mt: "xs", children: debugDetails })] })] })), _jsx(Button, { onClick: () => void handleGenerate(), loading: busy, children: t("setupKey.generate.submit") })] }) }), _jsx(Tabs.Panel, { value: "import", pt: "md", children: _jsxs(Stack, { children: [_jsx(Text, { size: "sm", children: t("setupKey.import.description") }), _jsx(TextInput, { label: t("setupKey.import.armoredLabel"), value: armored, onChange: (e) => setArmored(e.currentTarget.value), placeholder: t("setupKey.import.armoredPlaceholder") }), _jsx(PasswordInput, { label: t("setupKey.passphraseImportLabel"), value: passphrase, onChange: (e) => setPassphrase(e.currentTarget.value) }), rawError !== null && (_jsxs(_Fragment, { children: [_jsx(Alert, { color: "red", children: error }), _jsxs("details", { style: { cursor: "pointer", marginTop: 4 }, children: [_jsxs("summary", { style: {
                                                        color: "var(--mantine-color-dimmed)",
                                                        fontSize: "0.85em",
                                                        padding: "4px 0",
                                                    }, children: ["\uD83D\uDD0D Debug info \u2014 log: ", debugLoc] }), _jsx(Code, { block: true, fz: "xs", mt: "xs", children: debugDetails })] })] })), _jsx(Button, { onClick: () => void handleImport(), loading: busy, children: t("setupKey.import.submit") }), _jsx(Code, { block: true, fz: "xs", children: t("setupKey.import.tip") })] }) }), _jsx(Tabs.Panel, { value: "export", pt: "md", children: _jsxs(Stack, { children: [_jsx(Text, { size: "sm", children: t("setupKey.export.description") }), _jsx(PasswordInput, { label: t("setupKey.passphraseVerifyLabel"), value: passphrase, onChange: (e) => setPassphrase(e.currentTarget.value) }), rawError !== null && (_jsxs(_Fragment, { children: [_jsx(Alert, { color: "red", children: error }), _jsxs("details", { style: { cursor: "pointer", marginTop: 4 }, children: [_jsxs("summary", { style: {
                                                        color: "var(--mantine-color-dimmed)",
                                                        fontSize: "0.85em",
                                                        padding: "4px 0",
                                                    }, children: ["\uD83D\uDD0D Debug info \u2014 log: ", debugLoc] }), _jsx(Code, { block: true, fz: "xs", mt: "xs", children: debugDetails })] })] })), success !== null && _jsx(Alert, { color: "green", children: success }), _jsx(Button, { onClick: () => void handleExport(), children: t("setupKey.export.submit") })] }) }), _jsx(Tabs.Panel, { value: "share", pt: "md", children: _jsxs(Stack, { children: [_jsxs(Alert, { color: "red", icon: _jsx(IconShieldLock, { size: 16 }), title: t("setupKey.share.title"), children: [_jsx(Text, { size: "sm", children: t("setupKey.share.warning1") }), _jsx(Text, { size: "sm", mt: "xs", children: t("setupKey.share.warning2") }), _jsx(Text, { size: "sm", mt: "xs", children: t("setupKey.share.warning3") })] }), _jsx(PasswordInput, { label: t("setupKey.sharePassphraseLabel"), placeholder: t("setupKey.share.passphrasePlaceholder"), value: passphrase, onChange: (e) => setPassphrase(e.currentTarget.value) }), _jsx(Checkbox, { label: t("setupKey.share.confirmCheckbox"), checked: shareConfirmed, onChange: (e) => setShareConfirmed(e.currentTarget.checked) }), rawError !== null && (_jsxs(_Fragment, { children: [_jsx(Alert, { color: "red", children: error }), _jsxs("details", { style: { cursor: "pointer", marginTop: 4 }, children: [_jsxs("summary", { style: {
                                                        color: "var(--mantine-color-dimmed)",
                                                        fontSize: "0.85em",
                                                        padding: "4px 0",
                                                    }, children: ["\uD83D\uDD0D Debug info \u2014 log: ", debugLoc] }), _jsx(Code, { block: true, fz: "xs", mt: "xs", children: debugDetails })] })] })), !shareRevealed && (_jsx(Button, { leftSection: _jsx(IconEye, { size: 16 }), onClick: () => void handleReveal(), disabled: !shareConfirmed, children: t("setupKey.share.reveal") })), shareRevealed && privateKeyArmored !== null && (_jsxs(Stack, { gap: "xs", children: [_jsxs(Group, { justify: "space-between", align: "center", children: [_jsx(Text, { size: "xs", c: "dimmed", children: t("setupKey.share.revealedLabel") }), _jsx(CopyButton, { value: privateKeyArmored, timeout: 1500, children: ({ copied, copy }) => (_jsx(Button, { size: "xs", variant: "light", leftSection: copied ? _jsx(IconCheck, { size: 14 }) : _jsx(IconCopy, { size: 14 }), onClick: copy, children: copied ? t("setupKey.share.copied") : t("setupKey.share.copy") })) })] }), _jsx(ScrollArea, { h: 200, children: _jsx(Code, { block: true, fz: "xs", children: privateKeyArmored }) }), _jsx(Button, { variant: "light", leftSection: _jsx(IconDownload, { size: 16 }), onClick: () => void handleDownload(), loading: busy, children: t("setupKey.share.download") }), _jsx(Group, { justify: "center", children: _jsx(QRCode, { value: privateKeyArmored, size: 256 }) }), privateKeyArmored.length > 2500 && (_jsx(Alert, { color: "yellow", children: t("setupKey.share.qrWarning") }))] }))] }) })] })] }));
}
