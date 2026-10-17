import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Center, Group, Loader, Stack } from "@mantine/core";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { useSessionStore } from "@/features/auth/sessionStore";
import { usePrivateChat } from "@/features/chats/queries";
import type { DialogChat } from "@/features/chats/model";
import { useMarkAsRead } from "@/features/events/useMarkAsRead";
import { seedCache } from "@/features/dialog-store/store";
import { Composer } from "@/features/messages/components/Composer";
import { ForwardBar } from "@/features/messages/components/ForwardBar";
import { ForwardTargetPicker } from "@/features/messages/components/ForwardTargetPicker";
import { MessageBubble } from "@/features/messages/components/MessageBubble";
import { ThreadPanel } from "@/features/messages/components/ThreadPanel";
import { useForwardStore } from "@/features/messages/forwardStore";
import { THREAD_OPEN_EVENT } from "@/features/messages/jumpToMessage";
import type { DialogMessage, ListItems } from "@/features/messages/model";
import { usePrivateMessages } from "@/features/messages/queries";
import { useReplyCounts } from "@/features/messages/useReplyCounts";
import { ApiError, toUserMessage } from "@/infra/error";
import { useUserPublicKey } from "@/features/users/queries";
import { useChatScroll } from "@/lib/useChatScroll";

/**
 * For a 1:1 dialog, the peer is whichever of `user0` / `user1` isn't us.
 * Returns `undefined` if we can't determine the peer yet (chat still
 * loading, or current user not hydrated).
 */
function pickPeerId(
  chat: DialogChat | undefined,
  currentUserId: string | undefined,
): string | undefined {
  if (chat === undefined || currentUserId === undefined) return undefined;
  return chat.user0 === currentUserId ? chat.user1 : chat.user0;
}

export function ChatRoute(): JSX.Element | null {
  const { t } = useTranslation();
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();

  const kind: "private" | "group" = "private";

  const currentUser = useSessionStore((s) => s.user);

  const {
    data: messages,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
  } = usePrivateMessages(chatId);
  const { data: chat } = usePrivateChat(chatId);

  // Detect whether the peer has a PGP public key, so we can warn the
  // user before they compose a message that will only be readable by
  // themselves. The hook's `enabled` gate handles "peer not known yet".
  const peerId = pickPeerId(chat, currentUser?.id);
  const peerKey = useUserPublicKey(peerId);
  const peerMissingKey = peerKey.data?.has_public_key === false && !peerKey.isFetching;
  // A 404 means the peer UUID doesn't resolve to a user — degenerate
  // case, but treat it the same as "no key" so the user gets feedback.
  const peerLookup404 = peerKey.error instanceof ApiError && peerKey.error.status === 404;
  // Any OTHER lookup failure (network, 401/500, malformed payload —
  // e.g. the backend serving raw armor text instead of base64 used to
  // blow up the base64 decoder here) must not be silent: without this,
  // there is no banner, the composer stays enabled, and the send
  // throws a cryptic "peer public key missing". Surface it in red and
  // block the composer until the lookup succeeds.
  const peerLookupError = peerKey.error !== null && !peerLookup404;
  const peerLookupErrorMessage =
    peerLookupError && peerKey.error !== null ? toUserMessage(peerKey.error) : undefined;
  // True only while the hook hasn't produced data yet (initial mount
  // or a refetch). Once we have *any* answer — even has_public_key=false
  // — we treat the lookup as done.
  const peerKeyLoading = peerKey.data === undefined && peerKey.isFetching && !peerLookup404;

  const queryClient = useQueryClient();

  // Unified list scroll (Task 2): sticks to the bottom only when the user
  // was already near it, preserves the viewport offset when earlier
  // messages are prepended, and routes thread jumps through the hook.
  const scroll = useChatScroll({ resetKey: chatId, itemCount: messages?.items.length ?? 0 });

  // Reply-thread panel (Track D): opened by Track C's reply-quote click
  // via `openThread(messageId)` (`thread:open` window event).
  const [threadId, setThreadId] = useState<string | null>(null);
  // Forward target picker (Track C forward UI).
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    const onThreadOpen = (e: Event): void => {
      const messageId = (e as CustomEvent<{ messageId: string }>).detail?.messageId;
      if (typeof messageId === "string" && messageId.length > 0) {
        setThreadId(messageId);
      }
    };
    window.addEventListener(THREAD_OPEN_EVENT, onThreadOpen);
    return () => {
      window.removeEventListener(THREAD_OPEN_EVENT, onThreadOpen);
    };
  }, []);

  useMarkAsRead(chatId ?? "", kind);

  // Сидим React Query-кеш из шифрованного локального файла ДО того,
  // как отрезолвится сетевой fetch. Серверный ответ потом
  // перезапишет/смержит поверх через обычный `onSuccess`-путь.
  // Best-effort: если файла нет или он битый — пустой первый рендер.
  useEffect(() => {
    const ownerId = currentUser?.id;
    if (chatId === undefined || ownerId === undefined) return;
    let cancelled = false;
    void (async () => {
      const seeded = await seedCache(ownerId, chatId);
      if (cancelled || seeded === undefined) return;
      queryClient.setQueryData<{ pages: ListItems<DialogMessage>[]; pageParams: number[] }>(
        ["messages", kind, chatId],
        seeded,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, currentUser?.id, kind, queryClient]);

  // Reply counts for the "N replies" badges, computed once per list (not
  // per bubble). Must stay above the early returns (stable hook order).
  const replyCounts = useReplyCounts(messages?.items);

  // Forward selection for this chat (empty until the user picks a message
  // via a bubble's forward button). Selector mirrors the forward contract.
  const selected = useForwardStore((s) => s.selection[chatId ?? ""] ?? []);

  if (!chatId) return null;

  if (isLoading) {
    return (
      <Center mih={300}>
        <Loader />
      </Center>
    );
  }

  if (error) {
    return <Alert color="red">{toUserMessage(error)}</Alert>;
  }

  if (!messages) return null;

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
      : peerLookupErrorMessage;

  return (
    <Stack
      gap="xs"
      h="calc(100vh - 60px - 80px)"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <Group p="sm" gap="sm">
        <Button
          variant="subtle"
          size="xs"
          onClick={() => {
            navigate("/chats");
          }}
          leftSection={<IconArrowLeft size={16} />}
        >
          Back
        </Button>
        <strong>{chat?.name ?? "Chat"}</strong>
      </Group>

      <Stack
        gap="xs"
        ref={scroll.containerRef}
        onScroll={scroll.onScroll}
        style={{ flex: 1, overflowY: "auto", padding: "0 16px" }}
      >
        {hasNextPage === true && (
          <Button
            variant="subtle"
            size="xs"
            onClick={() => {
              // Snapshot the viewport first: the hook restores the offset
              // once the earlier page lands instead of jumping to bottom.
              scroll.beginPrepend();
              void fetchNextPage();
            }}
            m="sm"
          >
            Load earlier messages
          </Button>
        )}
        {allMessages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            chatId={chatId}
            replyCount={replyCounts[msg.id] ?? 0}
            selectMode={selected.length > 0}
            selected={selected.includes(msg.id)}
            kind={kind}
          />
        ))}
        <div ref={scroll.bottomAnchorRef} />
      </Stack>

      {(peerMissingKey || peerLookup404) && (
        <Alert
          color="yellow"
          icon={<IconAlertCircle size={16} />}
          mx="sm"
          title={t("chat.peerNoKeyTitle")}
        >
          {t("chat.peerNoKeyDescription", { email: peerLabel })}
        </Alert>
      )}

      {peerKeyLoading && (
        <Alert color="blue" icon={<Loader size={16} />} mx="sm" title={t("chat.loadingPeerKey")}>
          {t("chat.loadingPeerKey")}
        </Alert>
      )}

      {peerLookupErrorMessage !== undefined && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={16} />}
          mx="sm"
          title={t("chat.peerKeyErrorTitle")}
        >
          {peerLookupErrorMessage}
        </Alert>
      )}

      {selected.length > 0 && <ForwardBar chatId={chatId} onProceed={() => setPickerOpen(true)} />}

      <ForwardTargetPicker
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        sourceChatId={chatId}
        sourceKind={kind}
        messageIds={selected}
      />

      <Composer
        chatId={chatId}
        kind={kind}
        peerPublicKeyArmored={
          peerKey.data?.has_public_key === true ? (peerKey.data?.public_key ?? null) : null
        }
        {...(composerDisabledReason !== undefined
          ? { disabledReason: composerDisabledReason }
          : {})}
      />

      <ThreadPanel
        chatId={chatId}
        kind={kind}
        openedId={threadId}
        onClose={() => setThreadId(null)}
        onJump={scroll.jumpToId}
      />
    </Stack>
  );
}
