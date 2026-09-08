import { Group, Paper, Text } from "@mantine/core";
import { Link } from "react-router-dom";

import type { DialogChat } from "../model";

export interface ChatItemProps {
  chat: DialogChat;
  unreadCount: number;
}

export function ChatItem({ chat, unreadCount }: ChatItemProps) {
  return (
    <Paper
      component={Link}
      to={`/chats/${chat.id}`}
      p="sm"
      withBorder
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Text fw={500} truncate>
          {chat.name || chat.id}
        </Text>
        {unreadCount > 0 && (
          <Text
            size="xs"
            fw={700}
            c="white"
            bg="blue"
            px={8}
            style={{ borderRadius: 10, minWidth: 20, textAlign: "center" }}
          >
            {unreadCount}
          </Text>
        )}
      </Group>
    </Paper>
  );
}
