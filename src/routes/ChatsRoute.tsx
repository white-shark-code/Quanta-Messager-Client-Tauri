import { Alert, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { ChatItem } from "@/features/chats/components/ChatItem";
import { EmptyChatsState } from "@/features/chats/components/EmptyChatsState";
import { usePrivateChats } from "@/features/chats/queries";
import { getDialogEvents } from "@/features/events/api";
import { toUserMessage } from "@/infra/error";

export function ChatsRoute() {
  const { data: chats, isLoading, error } = usePrivateChats();
  const { data: events } = useQuery({
    queryKey: ["events", "dialog"],
    queryFn: () => getDialogEvents().then((r) => r.items),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <Center mih={200}>
        <Loader />
      </Center>
    );
  }
  if (error) {
    return <Alert color="red">{toUserMessage(error)}</Alert>;
  }
  if (!chats || chats.length === 0) {
    return <EmptyChatsState />;
  }

  const unreadByChat = new Map<string, number>();
  events?.forEach((e) => unreadByChat.set(e.chat_id, e.count));

  return (
    <Stack gap="xs" p="md">
      <Group justify="space-between">
        <Text size="xl" fw={600}>
          Chats
        </Text>
      </Group>
      {chats.map((chat) => (
        <ChatItem key={chat.id} chat={chat} unreadCount={unreadByChat.get(chat.id) ?? 0} />
      ))}
    </Stack>
  );
}
