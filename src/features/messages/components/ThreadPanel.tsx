import { useMemo } from "react";
import { Drawer, Group, Paper, Text, Timeline } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { useSessionStore } from "@/features/auth/sessionStore";
import { useUserPublicKey } from "@/features/users/queries";

import type { DialogMessage } from "../model";
import { isPendingMessage, type PendingMessage } from "../mutations";
import { jumpToMessage } from "../jumpToMessage";
import {
  getDecrypted,
  useDecryptedMessage,
  useGroupMessages,
  usePrivateMessages,
} from "../queries";
import type { ReplyRef } from "../replyEnvelope";
import { buildThread } from "../thread";

/**
 * Read the reply link for a message without subscribing to React state.
 * Pending optimistic rows carry the link as `replyPreview`; sent rows
 * expose it via the decryption cache (`DecryptedMessage.reply`).
 */
function peekReplyOf(message: DialogMessage | PendingMessage): ReplyRef | null {
  if (isPendingMessage(message)) return message.replyPreview ?? null;
  return getDecrypted(message.id)?.reply ?? null;
}

/**
 * Close the panel, then scroll the chat list to a message anchor and
 * flash-highlight it (shared helper owned by Track C — scrolls to the
 * `msg-<id>` anchor and dispatches `message:highlight` for the bubble).
 */
function closeAndJump(messageId: string, onClose: () => void): void {
  onClose();
  requestAnimationFrame(() => {
    jumpToMessage(messageId);
  });
}

function ThreadNodeBody({ message }: { message: DialogMessage }): JSX.Element {
  const { t } = useTranslation();
  const currentUser = useSessionStore((s) => s.user);
  const pending = isPendingMessage(message);
  const isMine = message.owner_id === currentUser?.id;

  // Same sender-key resolution as `MessageBubble`: verify peer messages
  // against the sender's key, own/pending messages against the fallback.
  const senderKey = useUserPublicKey(!pending && !isMine ? message.owner_id : undefined);
  const senderArmor =
    senderKey.data?.has_public_key === true ? (senderKey.data.public_key ?? undefined) : undefined;

  const { data: decrypted, isLoading: decrypting } = useDecryptedMessage(
    message.id,
    pending ? "" : message.encrypted_message,
    pending ? "" : (message.signature ?? ""),
    senderArmor,
  );

  const text = pending
    ? message.text
    : (decrypted?.text ?? (decrypting ? t("messages.decrypting") : t("messages.locked")));

  return (
    <Paper p="xs" withBorder>
      <Text size="xs" c="dimmed">
        {message.owner_id.slice(0, 8)}
      </Text>
      <Text size="sm">{text}</Text>
    </Paper>
  );
}

interface ThreadNodeRowProps {
  nodeId: string;
  missing: boolean;
  message: DialogMessage | undefined;
  onJump: (messageId: string) => void;
}

function ThreadNodeRow({ nodeId, missing, message, onJump }: ThreadNodeRowProps): JSX.Element {
  const { t } = useTranslation();
  if (missing || message === undefined) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        {t("messages.originalUnavailable", { defaultValue: "Original message unavailable" })}
      </Text>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      style={{ cursor: "pointer" }}
      onClick={() => onJump(nodeId)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onJump(nodeId);
      }}
    >
      <ThreadNodeBody message={message} />
    </div>
  );
}

export interface ThreadPanelProps {
  chatId: string;
  kind: "private" | "group";
  openedId: string | null;
  onClose: () => void;
}

export function ThreadPanel({ chatId, kind, openedId, onClose }: ThreadPanelProps): JSX.Element {
  const { t } = useTranslation();

  // Both hooks stay mounted unconditionally (stable hook order); the
  // `enabled` gate inside each one keeps the irrelevant kind idle.
  const privateQuery = usePrivateMessages(
    kind === "private" && openedId !== null ? chatId : undefined,
  );
  const groupQuery = useGroupMessages(kind === "group" && openedId !== null ? chatId : undefined);
  const messages: DialogMessage[] = useMemo(
    () => (kind === "private" ? privateQuery.data?.items : groupQuery.data?.items) ?? [],
    [kind, privateQuery.data?.items, groupQuery.data?.items],
  );

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const thread = useMemo(
    () =>
      openedId === null
        ? []
        : buildThread(
            messages.map((m) => ({ id: m.id, reply: peekReplyOf(m) })),
            openedId,
          ),
    [messages, openedId],
  );

  return (
    <Drawer
      position="right"
      opened={openedId !== null}
      onClose={onClose}
      title={t("messages.viewThread", { defaultValue: "Thread" })}
    >
      <Timeline active={thread.length - 1} bulletSize={12} lineWidth={2}>
        {thread.map((node) => (
          <Timeline.Item key={node.id} title={`#${node.id.slice(0, 8)}`}>
            <Group gap="xs" align="flex-start">
              <div style={{ flex: 1 }}>
                <ThreadNodeRow
                  nodeId={node.id}
                  missing={node.missing}
                  message={byId.get(node.id)}
                  onJump={(id) => closeAndJump(id, onClose)}
                />
              </div>
            </Group>
          </Timeline.Item>
        ))}
      </Timeline>
    </Drawer>
  );
}
