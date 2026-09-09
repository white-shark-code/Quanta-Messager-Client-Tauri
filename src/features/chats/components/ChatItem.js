import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Group, Paper, Text } from "@mantine/core";
import { IconLock, IconUsers } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { isGroupChat } from "../api";
export function ChatItem({ chat, unreadCount }) {
    const { t } = useTranslation();
    const isGroup = isGroupChat(chat);
    return (_jsx(Paper, { component: Link, to: `/chats/${chat.id}`, p: "sm", withBorder: true, style: { textDecoration: "none", color: "inherit" }, children: _jsxs(Group, { justify: "space-between", wrap: "nowrap", children: [_jsxs(Group, { gap: "xs", wrap: "nowrap", style: { minWidth: 0, flex: 1 }, children: [isGroup ? (_jsx(IconUsers, { size: 16, "aria-label": t("common.a11y.groupChat") })) : (_jsx(IconLock, { size: 16, "aria-label": t("common.a11y.privateChat") })), _jsx(Text, { fw: unreadCount > 0 ? 600 : 500, truncate: true, children: chat.name || chat.id })] }), unreadCount > 0 && (_jsx(Text, { size: "xs", fw: 700, c: "white", bg: "blue", px: 8, style: { borderRadius: 10, minWidth: 20, textAlign: "center" }, children: unreadCount }))] }) }));
}
