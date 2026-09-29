import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Center, Group, Loader, Stack, Text } from "@mantine/core";

import { usePrivateChats, useGroupChats } from "@/features/chats/queries";
import { useEventsPolling } from "@/features/events/polling";
import { ChatItem } from "@/features/chats/components/ChatItem";
import { EmptyChatsState } from "@/features/chats/components/EmptyChatsState";
import { toUserMessage } from "@/infra/error";

import type { AnyChat } from "@/features/chats/model";

export function ChatsRoute(): JSX.Element {
  const { t } = useTranslation();
  const privateChats = usePrivateChats();
  const groupChats = useGroupChats();
  const { data: events } = useEventsPolling();

  const allChats = useMemo<AnyChat[]>(() => {
    const priv = privateChats.data?.pages.flatMap((p) => p.items) ?? [];
    const grp = groupChats.data?.pages.flatMap((p) => p.items) ?? [];
    return [...priv, ...grp].sort((a, b) => b.create_at.localeCompare(a.create_at));
  }, [privateChats.data, groupChats.data]);

  const unreadByChat = useMemo(() => {
    const map = new Map<string, number>();
    events?.dialog.forEach((e) => map.set(e.chat_id, e.count));
    return map;
  }, [events]);

  const isLoading = privateChats.isLoading || groupChats.isLoading;
  const error = privateChats.error ?? groupChats.error;

  const canLoadMorePrivate =
    privateChats.hasNextPage === true && privateChats.isFetchingNextPage === false;
  const canLoadMoreGroup =
    groupChats.hasNextPage === true && groupChats.isFetchingNextPage === false;
  const canLoadMore = canLoadMorePrivate || canLoadMoreGroup;

  function handleLoadMore(): void {
    if (privateChats.hasNextPage === true) {
      void privateChats.fetchNextPage();
    }
    if (groupChats.hasNextPage === true) {
      void groupChats.fetchNextPage();
    }
  }

  if (isLoading) {
    return (
      <Center mih={300}>
        <Loader />
      </Center>
    );
  }

  if (error !== undefined && error !== null) {
    return <Alert color="red">{toUserMessage(error)}</Alert>;
  }

  if (allChats.length === 0) {
    return <EmptyChatsState />;
  }

  return (
    <Stack gap="xs" p="md">
      <Group justify="space-between">
        <Text size="xl" fw={600}>
          {t("chats.title")}
        </Text>
      </Group>
      {allChats.map((chat) => (
        <ChatItem key={chat.id} chat={chat} unreadCount={unreadByChat.get(chat.id) ?? 0} />
      ))}
      {canLoadMore && (
        <Group justify="center">
          <Button
            variant="subtle"
            onClick={() => void handleLoadMore()}
            loading={privateChats.isFetchingNextPage || groupChats.isFetchingNextPage}
          >
            {t("chats.loadMore")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
