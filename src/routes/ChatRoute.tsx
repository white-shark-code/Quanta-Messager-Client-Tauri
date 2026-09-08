import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Center, Group, Loader, Stack } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";

import { usePrivateChat } from "@/features/chats/queries";
import { useMarkAsRead } from "@/features/events/useMarkAsRead";
import { Composer } from "@/features/messages/components/Composer";
import { MessageBubble } from "@/features/messages/components/MessageBubble";
import { usePrivateMessages } from "@/features/messages/queries";
import { toUserMessage } from "@/infra/error";

export function ChatRoute(): JSX.Element | null {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();

  const kind: "private" | "group" = "private";

  const {
    data: messages,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
  } = usePrivateMessages(chatId);
  const { data: chat } = usePrivateChat(chatId);

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

      <Composer chatId={chatId} kind={kind} />
    </Stack>
  );
}
