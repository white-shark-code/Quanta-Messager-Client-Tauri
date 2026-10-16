import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconCheck,
  IconMessageReply,
  IconRefresh,
  IconShare,
} from "@tabler/icons-react";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";

import { useSessionStore } from "@/features/auth/sessionStore";
import { useUserPublicKey } from "@/features/users/queries";

import { ForwardedMarker } from "./ForwardedMarker";
import {
  jumpToMessage,
  messageAnchorId,
  MESSAGE_HIGHLIGHT_EVENT,
  openThread,
} from "../jumpToMessage";
import type { DialogMessage } from "../model";
import { useRetryMessage, type PendingMessage } from "../mutations";
import { useDecryptedMessage } from "../queries";
import { truncatePreview, type ForwardRef, type ReplyRef } from "../replyEnvelope";
import { useForwardStore } from "../forwardStore";
import { useReplyStore } from "../replyStore";
import { MessageAttachments } from "./MessageAttachments";

type AnyMessage = DialogMessage | PendingMessage;

function isPending(msg: AnyMessage): msg is PendingMessage {
  return (msg as PendingMessage).optimistic === true;
}

/** How long a scroll-target bubble keeps its flash highlight (ms). */
const HIGHLIGHT_MS = 2000;

interface MessageBubbleProps {
  message: AnyMessage;
  chatId: string;
  /** Number of replies to this message; the badge hides when 0/undefined. */
  replyCount?: number;
  /** Forward selection mode: show a checkbox instead of the forward button. */
  selectMode?: boolean;
  /** Whether this message is in the forward selection (only in selectMode). */
  selected?: boolean;
  /** Chat flavor for the attachments endpoint. Defaults to private. */
  kind?: "private" | "group";
}

export function MessageBubble({
  message,
  chatId,
  replyCount,
  selectMode = false,
  selected = false,
  kind = "private",
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const currentUser = useSessionStore((s) => s.user);
  const isMine = message.owner_id === currentUser?.id;
  const pending = isPending(message);
  const retry = useRetryMessage(chatId);
  const setReply = useReplyStore((s) => s.setReply);
  const toggleForwardSelect = useForwardStore((s) => s.toggleSelect);
  const [hovering, setHovering] = useState(false);
  // Touch devices have no hover: keep the action buttons always visible.
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  const actionsVisible = hovering || coarsePointer === true;
  const [highlighted, setHighlighted] = useState(false);
  const highlightTimer = useRef<number | null>(null);

  // Flash-highlight when a reply quote (or the thread panel) jumps to
  // this message. Timer cleared on re-trigger and on unmount.
  useEffect(() => {
    const onHighlight = (e: Event): void => {
      const id = (e as CustomEvent<{ messageId: string }>).detail?.messageId;
      if (id !== message.id) return;
      setHighlighted(true);
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => setHighlighted(false), HIGHLIGHT_MS);
    };
    window.addEventListener(MESSAGE_HIGHLIGHT_EVENT, onHighlight);
    return () => {
      window.removeEventListener(MESSAGE_HIGHLIGHT_EVENT, onHighlight);
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    };
  }, [message.id]);

  // Resolve the ACTUAL sender's key for verification instead of our
  // own: every message carries `owner_id`, and the peer-key lookup is
  // cached per user id (shared with ChatRoute), so in 1:1 chats this
  // adds zero network requests. Own/pending messages keep the previous
  // behaviour — `undefined` falls back to our own key in `tryDecrypt`.
  // A peer without an uploaded key also falls back (mis-verifies to `!`,
  // which is honest: there is nothing to verify against).
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
  const verified = pending ? true : (decrypted?.verified ?? false);
  const time: Dayjs = pending ? dayjs(message.createdAt) : dayjs(message.creation_datetime);

  // Quote target: decrypted envelope for confirmed rows, optimistic
  // preview for pending rows (they have no ciphertext to decrypt yet).
  const replyRef: ReplyRef | null =
    decrypted?.reply ?? (pending ? (message.replyPreview ?? null) : null);

  function handleReply(): void {
    if (pending) return;
    setReply(chatId, {
      id: message.id,
      sender: message.owner_id,
      preview: truncatePreview(decrypted?.text ?? text),
    });
  }

  function handleForward(): void {
    if (pending) return;
    // Entering selection mode selects the clicked message immediately —
    // no second click needed for the first message.
    toggleForwardSelect(chatId, message.id);
  }

  // Rows with no decryptable text (locked) can't be forwarded; pending /
  // failed rows get no forward/select UI at all.
  const locked = !pending && (decrypted?.text?.length ?? 0) === 0;
  const forwarded: ForwardRef | null = decrypted?.forwarded ?? null;

  const showBadge = replyCount !== undefined && replyCount > 0;
  const forwardLabel = t("messages.forward", { defaultValue: "Forward" });

  return (
    <Group
      id={messageAnchorId(message.id)}
      justify={isMine ? "flex-end" : "flex-start"}
      wrap="nowrap"
      gap="xs"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Paper
        p="sm"
        maw="70%"
        withBorder
        style={{
          backgroundColor: isMine
            ? "var(--mantine-color-blue-light)"
            : "var(--mantine-color-default)",
          ...(highlighted ? { boxShadow: "0 0 0 2px var(--mantine-color-blue-filled)" } : {}),
        }}
      >
        <Stack gap={4}>
          {replyRef !== null && (
            <Paper
              withBorder
              p="xs"
              role="button"
              tabIndex={0}
              aria-label={t("messages.viewThread", { defaultValue: "View thread" })}
              onClick={() => jumpToMessage(replyRef.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") jumpToMessage(replyRef.id);
              }}
              style={{
                cursor: "pointer",
                borderLeft: "3px solid var(--mantine-color-blue-filled)",
              }}
            >
              <Text size="xs" c="dimmed">
                {replyRef.sender.slice(0, 8)}
              </Text>
              <Text size="xs" lineClamp={2}>
                {replyRef.preview.length > 0
                  ? replyRef.preview
                  : t("messages.originalUnavailable", {
                      defaultValue: "Original message unavailable",
                    })}
              </Text>
            </Paper>
          )}
          {forwarded !== null && <ForwardedMarker forwarded={forwarded} chatId={chatId} />}
          <Text size="sm">
            {text ?? (decrypting ? t("messages.decrypting") : t("messages.locked"))}
          </Text>
          {!pending && <MessageAttachments messageId={message.id} kind={kind} chatId={chatId} />}
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
              {!pending && (
                <Tooltip label={t("messages.reply", { defaultValue: "Reply" })}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label={t("messages.reply", { defaultValue: "Reply" })}
                    onClick={handleReply}
                    style={{ opacity: actionsVisible ? 1 : 0, transition: "opacity 120ms" }}
                  >
                    <IconMessageReply size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              {!pending && selectMode && (
                <Checkbox
                  size="xs"
                  aria-label={forwardLabel}
                  checked={selected}
                  onChange={handleForward}
                />
              )}
              {!pending && !selectMode && (
                <Tooltip
                  label={
                    locked
                      ? t("messages.forwardUndecryptable", {
                          defaultValue: "Cannot forward an undecrypted message",
                        })
                      : forwardLabel
                  }
                >
                  {locked ? (
                    <span style={{ display: "inline-flex" }}>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        aria-label={forwardLabel}
                        disabled
                        style={{ opacity: actionsVisible ? 1 : 0, transition: "opacity 120ms" }}
                      >
                        <IconShare size={14} />
                      </ActionIcon>
                    </span>
                  ) : (
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      aria-label={forwardLabel}
                      onClick={handleForward}
                      style={{ opacity: actionsVisible ? 1 : 0, transition: "opacity 120ms" }}
                    >
                      <IconShare size={14} />
                    </ActionIcon>
                  )}
                </Tooltip>
              )}
            </Group>
          </Group>
          {showBadge && (
            <Group justify="flex-end">
              <Button
                variant="subtle"
                size="xs"
                title={t("messages.viewThread", { defaultValue: "View thread" })}
                onClick={() => openThread(message.id)}
              >
                {t("messages.repliesCount", {
                  count: replyCount,
                  defaultValue: "{{count}} replies",
                })}
              </Button>
            </Group>
          )}
        </Stack>
      </Paper>
    </Group>
  );
}
