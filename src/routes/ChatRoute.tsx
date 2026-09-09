import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Center, Group, Loader, Stack } from "@mantine/core";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { useSessionStore } from "@/features/auth/sessionStore";
import { usePrivateChat } from "@/features/chats/queries";
import type { DialogChat } from "@/features/chats/model";
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
  const peerMissingKey =
    peerKey.data !== undefined &&
    peerKey.data.has_public_key === false &&
    !peerKey.isFetching;
  // A 404 means the peer UUID doesn't resolve to a user — degenerate
  // case, but treat it the same as "no key" so the user gets feedback.
  const peerLookup404 =
    peerKey.error instanceof ApiError && peerKey.error.status === 404;

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useMarkAsRead(chatId ?? "", kind);

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
  const composerDisabledReason =
    peerMissingKey || peerLookup404
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

      <Composer
        chatId={chatId}
        kind={kind}
        peerPublicKeyArmored={peerKey.data?.public_key ?? null}
        {...(composerDisabledReason !== undefined
          ? { disabledReason: composerDisabledReason }
          : {})}
      />
    </Stack>
  );
}
