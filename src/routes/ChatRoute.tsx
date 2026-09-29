import { useEffect, useRef } from "react";
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
import { MessageBubble } from "@/features/messages/components/MessageBubble";
import type { DialogMessage, ListItems } from "@/features/messages/model";
import { usePrivateMessages } from "@/features/messages/queries";
import { ApiError, toUserMessage } from "@/infra/error";
import { useUserPublicKey } from "@/features/users/queries";

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
  // True only while the hook hasn't produced data yet (initial mount
  // or a refetch). Once we have *any* answer — even has_public_key=false
  // — we treat the lookup as done.
  const peerKeyLoading = peerKey.data === undefined && peerKey.isFetching && !peerLookup404;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      : undefined;

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

      <Stack gap="xs" style={{ flex: 1, overflowY: "auto", padding: "0 16px" }}>
        {hasNextPage === true && (
          <Button variant="subtle" size="xs" onClick={() => void fetchNextPage()} m="sm">
            Load earlier messages
          </Button>
        )}
        {allMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} chatId={chatId} />
        ))}
        <div ref={messagesEndRef} />
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
    </Stack>
  );
}
