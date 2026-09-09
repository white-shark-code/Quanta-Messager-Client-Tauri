import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button, Center, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
export function EmptyChatsState() {
    const { t } = useTranslation();
    return (_jsx(Center, { mih: 300, p: "md", children: _jsxs(Stack, { align: "center", gap: "md", children: [_jsx(Text, { size: "lg", c: "dimmed", children: t("chats.empty") }), _jsx(Button, { component: Link, to: "/chats/new", children: t("chats.startNew") })] }) }));
}
