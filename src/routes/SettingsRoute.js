import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Settings route (TASK-081).
 *
 * Tabbed settings page per `docs/design.md` §9.2:
 *   - Profile    — current user from `sessionStore` + logout.
 *   - Appearance — theme / language / polling / auto-lock / notifications.
 *   - About      — version banner.
 *
 * Key management lives exclusively on `/setup-key` (Generate / Import /
 * Export / Share tabs). It is not surfaced here.
 *
 * All persisted settings are written through `useSettingsStore.set`,
 * which mirrors them to the Tauri LazyStore on disk.
 */
import { useEffect, useState } from "react";
import { Badge, Button, Checkbox, Code, Divider, Group, Modal, NumberInput, Paper, ScrollArea, SegmentedControl, Stack, Switch, Tabs, Text, Title, } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLogout, IconRefresh } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "@/features/auth/sessionStore";
import { deleteKeystoreForUser } from "@/features/keyring/generate";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { clearDebugLog, getDebugLog, getDebugLogLocation, } from "@/lib/debug";
import { ColorSchemeToggle } from "@/ui/components/ColorSchemeToggle";
export function SettingsRoute() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const user = useSessionStore((s) => s.user);
    const lock = useSessionStore((s) => s.lock);
    const clearKeyring = useKeyringStore((s) => s.clear);
    const theme = useSettingsStore((s) => s.theme);
    const setSetting = useSettingsStore((s) => s.set);
    const language = useSettingsStore((s) => s.language);
    const pollingIntervalMs = useSettingsStore((s) => s.pollingIntervalMs);
    const idleTimeoutMs = useSettingsStore((s) => s.idleTimeoutMs);
    const autoLockEnabled = useSettingsStore((s) => s.autoLockEnabled);
    const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
    const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
    const [eraseData, setEraseData] = useState(false);
    // Diagnostics panel state.
    const [debugContent, setDebugContent] = useState("");
    const [debugLocation, setDebugLocation] = useState("");
    async function refreshDebugLog() {
        setDebugLocation(getDebugLogLocation());
        setDebugContent(await getDebugLog());
    }
    useEffect(() => {
        void refreshDebugLog();
    }, []);
    async function handleLogout() {
        const uid = user?.id;
        if (uid !== undefined && eraseData) {
            try {
                await deleteKeystoreForUser(uid);
            }
            catch {
                // best-effort — still proceed with logout
            }
        }
        // `clear()` wipes the in-memory keyring entirely (public + private +
        // fingerprint) so a subsequent login can't be misled by stale
        // `publicKeyArmored` pointing at a deleted keystore file.
        clearKeyring();
        lock();
        setEraseData(false);
        closeConfirm();
        navigate("/login", { replace: true });
    }
    return (_jsxs(Stack, { gap: "md", p: "md", maw: 800, mx: "auto", children: [_jsx(Title, { order: 2, children: t("settings.title") }), _jsxs(Tabs, { defaultValue: "profile", children: [_jsxs(Tabs.List, { children: [_jsx(Tabs.Tab, { value: "profile", children: t("settings.profile") }), _jsx(Tabs.Tab, { value: "appearance", children: t("settings.appearance") }), _jsx(Tabs.Tab, { value: "about", children: t("settings.about") })] }), _jsx(Tabs.Panel, { value: "profile", pt: "md", children: _jsx(Paper, { withBorder: true, p: "md", children: _jsxs(Stack, { children: [_jsxs(Group, { justify: "space-between", children: [_jsx(Text, { fw: 500, children: t("settings.email") }), _jsx(Text, { children: user?.email ?? "—" })] }), _jsxs(Group, { justify: "space-between", children: [_jsx(Text, { fw: 500, children: t("settings.userId") }), _jsx(Code, { children: user?.id ?? "—" })] }), _jsx(Divider, {}), _jsx(Button, { color: "red", variant: "light", leftSection: _jsx(IconLogout, { size: 16 }), onClick: openConfirm, children: t("auth.logout") })] }) }) }), _jsx(Tabs.Panel, { value: "appearance", pt: "md", children: _jsxs(Stack, { children: [_jsx(Paper, { withBorder: true, p: "md", children: _jsxs(Stack, { children: [_jsx(Text, { fw: 500, children: t("settings.theme") }), _jsxs(Group, { children: [_jsx(ColorSchemeToggle, {}), _jsx(Text, { size: "sm", c: "dimmed", children: t("settings.currentTheme", { theme }) })] })] }) }), _jsx(Paper, { withBorder: true, p: "md", children: _jsxs(Stack, { children: [_jsx(Text, { fw: 500, children: t("settings.language") }), _jsx(SegmentedControl, { value: language, onChange: (v) => void setSetting("language", v), data: [
                                                    { value: "ru", label: "Русский" },
                                                    { value: "en", label: "English" },
                                                    { value: "vi", label: "Tiếng Việt" },
                                                ] })] }) }), _jsx(Paper, { withBorder: true, p: "md", children: _jsxs(Stack, { children: [_jsx(Text, { fw: 500, children: t("settings.pollingInterval") }), _jsx(NumberInput, { value: pollingIntervalMs, onChange: (v) => void setSetting("pollingIntervalMs", typeof v === "number" ? v : 5000), min: 1000, max: 60000, step: 1000 })] }) }), _jsx(Paper, { withBorder: true, p: "md", children: _jsxs(Stack, { children: [_jsx(Switch, { checked: autoLockEnabled, onChange: (e) => void setSetting("autoLockEnabled", e.currentTarget.checked), label: t("settings.autoLock") }), autoLockEnabled && (_jsx(NumberInput, { label: t("settings.idleTimeout"), value: idleTimeoutMs, onChange: (v) => void setSetting("idleTimeoutMs", typeof v === "number" ? v : 300000), min: 60000, max: 3600000, step: 60000 })), _jsx(Switch, { checked: notificationsEnabled, onChange: (e) => void setSetting("notificationsEnabled", e.currentTarget.checked), label: t("settings.notifications") })] }) })] }) }), _jsx(Tabs.Panel, { value: "about", pt: "md", children: _jsxs(Stack, { children: [_jsx(Paper, { withBorder: true, p: "md", children: _jsxs(Stack, { children: [_jsx(Text, { fw: 500, children: "Quant Messenger" }), _jsx(Text, { size: "sm", c: "dimmed", children: t("settings.version") }), _jsx(Text, { size: "sm", children: t("settings.aboutDescription") }), _jsx(Badge, { color: "green", variant: "light", children: "MIT License" })] }) }), _jsx(Paper, { withBorder: true, p: "md", children: _jsxs(Stack, { children: [_jsx(Text, { fw: 500, children: t("settings.diagnostics.title") }), _jsx(Text, { size: "xs", c: "dimmed", children: t("settings.diagnostics.locationLabel") }), _jsx(Code, { block: true, children: debugLocation }), _jsxs(Group, { children: [_jsx(Button, { size: "xs", variant: "light", leftSection: _jsx(IconRefresh, { size: 14 }), onClick: () => void refreshDebugLog(), children: t("settings.diagnostics.refresh") }), _jsx(Button, { size: "xs", variant: "light", onClick: () => {
                                                            void clearDebugLog().then(() => {
                                                                void refreshDebugLog();
                                                            });
                                                        }, children: t("settings.diagnostics.clear") })] }), _jsx(ScrollArea, { h: 240, children: _jsx(Code, { block: true, fz: "xs", children: debugContent.length > 0
                                                        ? debugContent
                                                        : t("settings.diagnostics.empty") }) })] }) })] }) })] }), _jsx(Modal, { opened: confirmOpened, onClose: closeConfirm, title: t("settings.logoutConfirmTitle"), centered: true, children: _jsxs(Stack, { children: [_jsx(Text, { size: "sm", children: t("settings.logoutConfirmText") }), _jsx(Checkbox, { label: t("settings.logoutEraseData"), checked: eraseData, onChange: (e) => setEraseData(e.currentTarget.checked) }), _jsxs(Group, { justify: "flex-end", gap: "xs", children: [_jsx(Button, { variant: "default", onClick: closeConfirm, children: t("common.cancel") }), _jsx(Button, { color: "red", onClick: () => void handleLogout(), children: t("auth.logout") })] })] }) })] }));
}
