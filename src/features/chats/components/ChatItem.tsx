import { Group, Paper, Text } from "@mantine/core";
import { IconLock, IconUsers } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { isGroupChat, type AnyChat } from "../api";

export interface ChatItemProps {
  chat: AnyChat;
  unreadCount: number;
}

export function ChatItem({ chat, unreadCount }: ChatItemProps): JSX.Element {
  const { t } = useTranslation();
  const isGroup = isGroupChat(chat);

  return (
    <Paper
      component={Link}
      to={`/chats/${chat.id}`}
      p="sm"
      withBorder
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          {isGroup ? (
            <IconUsers size={16} aria-label={t("common.a11y.groupChat")} />
          ) : (
            <IconLock size={16} aria-label={t("common.a11y.privateChat")} />
          )}
          <Text fw={unreadCount > 0 ? 600 : 500} truncate>
            {chat.name || chat.id}
          </Text>
        </Group>
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
