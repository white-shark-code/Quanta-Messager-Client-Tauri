import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Center, Group, Loader, Stack } from "@mantine/core";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/features/auth/sessionStore";
import { usePrivateChat } from "@/features/chats/queries";
import { useMarkAsRead } from "@/features/events/useMarkAsRead";
import { Composer } from "@/features/messages/components/Composer";
import { MessageBubble } from "@/features/messages/components/MessageBubble";
import { usePrivateMessages } from "@/features/messages/queries";
import { ApiError, toUserMessage } from "@/infra/error";
import { useUserPublicKey } from "@/features/users/queries";
/**
 * For a 1:1 dialog, the peer is whichever of `user0` / `user1` isn't us.
 * Returns `undefined` if we can't determine the peer yet (chat still
 * loading, or current user not hydrated).
 */
function pickPeerId(chat, currentUserId) {
    if (chat === undefined || currentUserId === undefined)
        return undefined;
    return chat.user0 === currentUserId ? chat.user1 : chat.user0;
}
export function ChatRoute() {
    const { t } = useTranslation();
    const { chatId } = useParams();
    const navigate = useNavigate();
    const kind = "private";
    const currentUser = useSessionStore((s) => s.user);
    const { data: messages, isLoading, error, fetchNextPage, hasNextPage, } = usePrivateMessages(chatId);
    const { data: chat } = usePrivateChat(chatId);
    // Detect whether the peer has a PGP public key, so we can warn the
    // user before they compose a message that will only be readable by
    // themselves. The hook's `enabled` gate handles "peer not known yet".
    const peerId = pickPeerId(chat, currentUser?.id);
    const peerKey = useUserPublicKey(peerId);
    const peerMissingKey = peerKey.data !== undefined &&
        peerKey.data.has_public_key === false &&
        !peerKey.isFetching;
    // A 404 means the peer UUID doesn't resolve to a user — degenerate
    // case, but treat it the same as "no key" so the user gets feedback.
    const peerLookup404 = peerKey.error instanceof ApiError && peerKey.error.status === 404;
    // True only while the hook hasn't produced data yet (initial mount
    // or a refetch). Once we have *any* answer — even has_public_key=false
    // — we treat the lookup as done.
    const peerKeyLoading = peerKey.data === undefined && peerKey.isFetching && !peerLookup404;
    const messagesEndRef = useRef(null);
    useMarkAsRead(chatId ?? "", kind);
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);
    if (!chatId)
        return null;
    if (isLoading) {
        return (_jsx(Center, { mih: 300, children: _jsx(Loader, {}) }));
    }
    if (error) {
        return _jsx(Alert, { color: "red", children: toUserMessage(error) });
    }
    if (!messages)
        return null;
    const allMessages = messages.items;
    // Compose the disabled-composer reason string when we know the peer
    // has no key. We don't have access to the peer's email from the chat
    // object itself, so we substitute the chat name as the best-available
    // human-readable identifier. If the chat name is missing, i18next
    // leaves `{email}` blank.
    const peerLabel = chat?.name ?? "";
    const composerDisabledReason = peerKeyLoading
        ? t("chat.loadingPeerKey")
        : peerMissingKey || peerLookup404
            ? t("chat.peerNoKeyDescription", { email: peerLabel })
            : undefined;
    return (_jsxs(Stack, { gap: "xs", h: "calc(100vh - 60px - 80px)", style: { display: "flex", flexDirection: "column" }, children: [_jsxs(Group, { p: "sm", gap: "sm", children: [_jsx(Button, { variant: "subtle", size: "xs", onClick: () => {
                            navigate("/chats");
                        }, leftSection: _jsx(IconArrowLeft, { size: 16 }), children: "Back" }), _jsx("strong", { children: chat?.name ?? "Chat" })] }), _jsxs(Stack, { gap: "xs", style: { flex: 1, overflowY: "auto", padding: "0 16px" }, children: [hasNextPage === true && (_jsx(Button, { variant: "subtle", size: "xs", onClick: () => void fetchNextPage(), m: "sm", children: "Load earlier messages" })), allMessages.map((msg) => (_jsx(MessageBubble, { message: msg, chatId: chatId }, msg.id))), _jsx("div", { ref: messagesEndRef })] }), (peerMissingKey || peerLookup404) && (_jsx(Alert, { color: "yellow", icon: _jsx(IconAlertCircle, { size: 16 }), mx: "sm", title: t("chat.peerNoKeyTitle"), children: t("chat.peerNoKeyDescription", { email: peerLabel }) })), peerKeyLoading && (_jsx(Alert, { color: "blue", icon: _jsx(Loader, { size: 16 }), mx: "sm", title: t("chat.loadingPeerKey"), children: t("chat.loadingPeerKey") })), _jsx(Composer, { chatId: chatId, kind: kind, peerPublicKeyArmored: peerKey.data?.has_public_key === true
                    ? (peerKey.data?.public_key ?? null)
                    : null, ...(composerDisabledReason !== undefined
                    ? { disabledReason: composerDisabledReason }
                    : {}) })] }));
}
