import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Group, Paper, Text, Loader, ActionIcon, Tooltip, Stack } from "@mantine/core";
import { IconCheck, IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { useDecryptedMessage } from "../queries";
import { useSessionStore } from "@/features/auth/sessionStore";
import { useRetryMessage } from "../mutations";
function isPending(msg) {
    return msg.optimistic === true;
}
export function MessageBubble({ message, chatId }) {
    const { t } = useTranslation();
    const currentUser = useSessionStore((s) => s.user);
    const isMine = message.owner_id === currentUser?.id;
    const pending = isPending(message);
    const retry = useRetryMessage(chatId);
    const { data: decrypted, isLoading: decrypting } = useDecryptedMessage(message.id, pending ? "" : message.encrypted_message, pending ? "" : message.signature);
    const text = pending
        ? message.text
        : (decrypted?.text ?? (decrypting ? t("messages.decrypting") : t("messages.locked")));
    const verified = pending ? true : (decrypted?.verified ?? false);
    const time = pending ? dayjs(message.createdAt) : dayjs(message.creation_datetime);
    return (_jsx(Group, { justify: isMine ? "flex-end" : "flex-start", wrap: "nowrap", gap: "xs", children: _jsx(Paper, { p: "sm", maw: "70%", withBorder: true, style: {
                backgroundColor: isMine ? "var(--mantine-color-blue-light)" : "var(--mantine-color-default)",
            }, children: _jsxs(Stack, { gap: 4, children: [_jsx(Text, { size: "sm", children: text ?? (decrypting ? t("messages.decrypting") : t("messages.locked")) }), _jsxs(Group, { gap: 4, justify: "space-between", children: [_jsx(Text, { size: "xs", c: "dimmed", children: time.format("HH:mm") }), _jsxs(Group, { gap: 4, children: [pending && message.status === "pending" && _jsx(Loader, { size: 12 }), pending && message.status === "failed" && (_jsx(Tooltip, { label: t("messages.retry"), children: _jsx(ActionIcon, { size: "xs", variant: "subtle", color: "red", onClick: () => {
                                                retry(message.id);
                                            }, children: _jsx(IconRefresh, { size: 12 }) }) })), !pending && verified && (_jsx(Tooltip, { label: t("messages.verified"), children: _jsx(IconCheck, { size: 12, color: "green" }) })), !pending && !verified && (_jsx(Tooltip, { label: t("messages.invalidSignature"), children: _jsx(IconAlertCircle, { size: 12, color: "red" }) }))] })] })] }) }) }));
}
