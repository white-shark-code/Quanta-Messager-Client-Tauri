import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { ActionIcon, Alert, Button, Group, Paper, Textarea, Tooltip } from "@mantine/core";
import { IconAlertCircle, IconLock, IconSend, IconSettings } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { useSessionStore } from "@/features/auth/sessionStore";
import { hasKeystore } from "@/infra/tauriBridge";
import { toUserMessage } from "@/infra/error";
import { useComposerStore } from "../composerStore";
import { useSendGroupMessage, useSendPrivateMessage } from "../mutations";
export function Composer({ chatId, kind = "private", disabledReason, peerPublicKeyArmored, }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const text = useComposerStore((s) => s.drafts[chatId]?.text ?? "");
    const setText = useComposerStore((s) => s.setText);
    const clearDraft = useComposerStore((s) => s.clearDraft);
    const sendPrivate = useSendPrivateMessage(chatId, peerPublicKeyArmored);
    const sendGroup = useSendGroupMessage(chatId, peerPublicKeyArmored);
    const send = kind === "private" ? sendPrivate : sendGroup;
    const hasKeys = useKeyringStore((s) => s.privateKey !== null);
    const currentUserId = useSessionStore((s) => s.user?.id);
    const textareaRef = useRef(null);
    const [sendError, setSendError] = useState(null);
    const [keystoreOnDisk, setKeystoreOnDisk] = useState(null);
    useEffect(() => {
        if (currentUserId === undefined)
            return;
        void hasKeystore(currentUserId).then(setKeystoreOnDisk);
    }, [currentUserId]);
    function handleTextChange(value) {
        setText(chatId, value);
        if (sendError !== null)
            setSendError(null);
    }
    function handleKeyDown(e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        }
    }
    async function handleSend() {
        if (!text.trim())
            return;
        setSendError(null);
        const currentText = text;
        try {
            await send.mutateAsync({ chatId, text: currentText });
            clearDraft(chatId);
            textareaRef.current?.focus();
        }
        catch (e) {
            // Keep the message visible until the user types or dismisses it.
            setSendError(toUserMessage(e));
        }
    }
    function openUnlockModal() {
        window.dispatchEvent(new Event("unlock-modal:open"));
    }
    if (!hasKeys) {
        return (_jsx(Paper, { p: "md", withBorder: true, children: _jsxs(Group, { justify: "space-between", wrap: "wrap", children: [_jsxs(Group, { children: [_jsx(IconLock, { size: 16 }), _jsx("span", { children: t("messages.composer.unlockFirst") })] }), _jsxs(Group, { gap: "xs", children: [keystoreOnDisk === true && (_jsx(Button, { size: "xs", variant: "light", leftSection: _jsx(IconLock, { size: 14 }), onClick: openUnlockModal, children: t("messages.composer.unlockButton") })), _jsx(Button, { size: "xs", variant: "subtle", leftSection: _jsx(IconSettings, { size: 14 }), onClick: () => navigate("/create-keystore"), children: t("messages.composer.setupKeyButton") })] })] }) }));
    }
    return (_jsxs(Paper, { p: "sm", withBorder: true, children: [_jsxs(Group, { align: "flex-end", gap: "xs", children: [_jsx(Textarea, { ref: textareaRef, placeholder: disabledReason !== undefined
                            ? t("messages.composer.disabledPlaceholder")
                            : t("messages.composer.placeholder"), value: text, onChange: (e) => handleTextChange(e.currentTarget.value), onKeyDown: handleKeyDown, autosize: true, minRows: 1, maxRows: 6, style: { flex: 1 }, disabled: disabledReason !== undefined }), _jsx(Tooltip, { label: t("messages.composer.sendTooltip"), children: _jsx(ActionIcon, { size: "lg", variant: "filled", onClick: () => void handleSend(), disabled: disabledReason !== undefined || !text.trim() || send.isPending, loading: send.isPending, children: _jsx(IconSend, { size: 18 }) }) })] }), sendError !== null && (_jsx(Alert, { color: "red", icon: _jsx(IconAlertCircle, { size: 16 }), mt: "xs", withCloseButton: true, onClose: () => setSendError(null), children: sendError }))] }));
}
