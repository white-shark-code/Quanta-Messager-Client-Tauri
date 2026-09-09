import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Center, Group, Loader, Stack, Text, } from "@mantine/core";
import { usePrivateChats, useGroupChats } from "@/features/chats/queries";
import { useEventsPolling } from "@/features/events/polling";
import { ChatItem } from "@/features/chats/components/ChatItem";
import { EmptyChatsState } from "@/features/chats/components/EmptyChatsState";
import { toUserMessage } from "@/infra/error";
export function ChatsRoute() {
    const { t } = useTranslation();
    const privateChats = usePrivateChats();
    const groupChats = useGroupChats();
    const { data: events } = useEventsPolling();
    const allChats = useMemo(() => {
        const priv = privateChats.data?.pages.flatMap((p) => p.items) ?? [];
        const grp = groupChats.data?.pages.flatMap((p) => p.items) ?? [];
        return [...priv, ...grp].sort((a, b) => b.create_at.localeCompare(a.create_at));
    }, [privateChats.data, groupChats.data]);
    const unreadByChat = useMemo(() => {
        const map = new Map();
        events?.dialog.forEach((e) => map.set(e.chat_id, e.count));
        return map;
    }, [events]);
    const isLoading = privateChats.isLoading || groupChats.isLoading;
    const error = privateChats.error ?? groupChats.error;
    const canLoadMorePrivate = privateChats.hasNextPage === true &&
        privateChats.isFetchingNextPage === false;
    const canLoadMoreGroup = groupChats.hasNextPage === true &&
        groupChats.isFetchingNextPage === false;
    const canLoadMore = canLoadMorePrivate || canLoadMoreGroup;
    function handleLoadMore() {
        if (privateChats.hasNextPage === true) {
            void privateChats.fetchNextPage();
        }
        if (groupChats.hasNextPage === true) {
            void groupChats.fetchNextPage();
        }
    }
    if (isLoading) {
        return (_jsx(Center, { mih: 300, children: _jsx(Loader, {}) }));
    }
    if (error !== undefined && error !== null) {
        return _jsx(Alert, { color: "red", children: toUserMessage(error) });
    }
    if (allChats.length === 0) {
        return _jsx(EmptyChatsState, {});
    }
    return (_jsxs(Stack, { gap: "xs", p: "md", children: [_jsx(Group, { justify: "space-between", children: _jsx(Text, { size: "xl", fw: 600, children: t("chats.title") }) }), allChats.map((chat) => (_jsx(ChatItem, { chat: chat, unreadCount: unreadByChat.get(chat.id) ?? 0 }, chat.id))), canLoadMore && (_jsx(Group, { justify: "center", children: _jsx(Button, { variant: "subtle", onClick: () => void handleLoadMore(), loading: privateChats.isFetchingNextPage || groupChats.isFetchingNextPage, children: t("chats.loadMore") }) }))] }));
}
