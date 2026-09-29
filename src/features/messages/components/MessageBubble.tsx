import { Group, Paper, Text, Loader, ActionIcon, Tooltip, Stack } from "@mantine/core";
import { IconCheck, IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";

import type { DialogMessage } from "../model";
import type { PendingMessage } from "../mutations";
import { useDecryptedMessage } from "../queries";
import { useSessionStore } from "@/features/auth/sessionStore";
import { useRetryMessage } from "../mutations";

type AnyMessage = DialogMessage | PendingMessage;

function isPending(msg: AnyMessage): msg is PendingMessage {
  return (msg as PendingMessage).optimistic === true;
}

interface MessageBubbleProps {
  message: AnyMessage;
  chatId: string;
}

export function MessageBubble({ message, chatId }: MessageBubbleProps) {
  const { t } = useTranslation();
  const currentUser = useSessionStore((s) => s.user);
  const isMine = message.owner_id === currentUser?.id;
  const pending = isPending(message);
  const retry = useRetryMessage(chatId);

  const { data: decrypted, isLoading: decrypting } = useDecryptedMessage(
    message.id,
    pending ? "" : message.encrypted_message,
    pending ? "" : (message.signature ?? ""),
  );

  const text = pending
    ? message.text
    : (decrypted?.text ?? (decrypting ? t("messages.decrypting") : t("messages.locked")));
  const verified = pending ? true : (decrypted?.verified ?? false);
  const time: Dayjs = pending ? dayjs(message.createdAt) : dayjs(message.creation_datetime);

  return (
    <Group justify={isMine ? "flex-end" : "flex-start"} wrap="nowrap" gap="xs">
      <Paper
        p="sm"
        maw="70%"
        withBorder
        style={{
          backgroundColor: isMine
            ? "var(--mantine-color-blue-light)"
            : "var(--mantine-color-default)",
        }}
      >
        <Stack gap={4}>
          <Text size="sm">
            {text ?? (decrypting ? t("messages.decrypting") : t("messages.locked"))}
          </Text>
          <Group gap={4} justify="space-between">
            <Text size="xs" c="dimmed">
              {time.format("HH:mm")}
            </Text>
            <Group gap={4}>
              {pending && message.status === "pending" && <Loader size={12} />}
              {pending && message.status === "failed" && (
                <Tooltip label={t("messages.retry")}>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="red"
                    onClick={(): void => {
                      retry.retry(message.id);
                    }}
                  >
                    <IconRefresh size={12} />
                  </ActionIcon>
                </Tooltip>
              )}
              {!pending && verified && (
                <Tooltip label={t("messages.verified")}>
                  <IconCheck size={12} color="green" />
                </Tooltip>
              )}
              {!pending && !verified && (
                <Tooltip label={t("messages.invalidSignature")}>
                  <IconAlertCircle size={12} color="red" />
                </Tooltip>
              )}
            </Group>
          </Group>
        </Stack>
      </Paper>
    </Group>
  );
}
