import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ActionIcon, Alert, Button, Group, Paper, Text, Textarea, Tooltip } from "@mantine/core";
import { IconAlertCircle, IconLock, IconSend, IconSettings, IconX } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useKeyringStore } from "@/features/keyring/keyringStore";
import { useSessionStore } from "@/features/auth/sessionStore";
import { hasKeystore } from "@/infra/tauriBridge";
import { toUserMessage } from "@/infra/error";

import { useComposerStore } from "../composerStore";
import { useSendGroupMessage, useSendPrivateMessage } from "../mutations";
import { useReplyStore } from "../replyStore";

export interface ComposerProps {
  chatId: string;
  kind?: "private" | "group";
  /**
   * ASCII-armored PGP public key of the recipient (peer for 1:1, group
   * for group chat). When set, the message is encrypted to this
   * recipient so they can actually decrypt it. When omitted, the
   * message falls back to encrypting to the local user (notes-to-self).
   */
  peerPublicKeyArmored?: string | null;
  /**
   * When set, the composer is read-only: the textarea and send button
   * are disabled, the textarea placeholder is replaced with `disabledReason`,
   * and a yellow Alert mirrors the message below the input.
   *
   * Use this for "soft" disables — e.g. the recipient has no PGP key yet —
   * where the user should still see the chat and understand why they
   * can't send. The hard "you have no keys" block above (rendered when
   * `hasKeys` is false) is a stronger, separate state.
   */
  disabledReason?: string;
}

export function Composer({
  chatId,
  kind = "private",
  disabledReason,
  peerPublicKeyArmored,
}: ComposerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const text = useComposerStore((s) => s.drafts[chatId]?.text ?? "");
  const setText = useComposerStore((s) => s.setText);
  const clearDraft = useComposerStore((s) => s.clearDraft);
  const sendPrivate = useSendPrivateMessage(chatId, peerPublicKeyArmored);
  const sendGroup = useSendGroupMessage(chatId, peerPublicKeyArmored);
  const send = kind === "private" ? sendPrivate : sendGroup;
  const reply = useReplyStore((s) => s.replies[chatId]);
  const clearReply = useReplyStore((s) => s.clearReply);
  const hasKeys = useKeyringStore((s) => s.privateKey !== null);
  const currentUserId = useSessionStore((s) => s.user?.id);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [keystoreOnDisk, setKeystoreOnDisk] = useState<boolean | null>(null);

  useEffect(() => {
    if (currentUserId === undefined) return;
    void hasKeystore(currentUserId).then(setKeystoreOnDisk);
  }, [currentUserId]);

  function handleTextChange(value: string): void {
    setText(chatId, value);
    if (sendError !== null) setSendError(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  async function handleSend(): Promise<void> {
    if (!text.trim()) return;
    setSendError(null);
    const currentText = text;
    try {
      await send.mutateAsync({
        chatId,
        text: currentText,
        ...(reply !== undefined ? { replyTo: { id: reply.id } } : {}),
      });
      clearDraft(chatId);
      clearReply(chatId);
      textareaRef.current?.focus();
    } catch (e) {
      // Keep the message visible until the user types or dismisses it.
      setSendError(toUserMessage(e));
    }
  }

  function openUnlockModal(): void {
    window.dispatchEvent(new Event("unlock-modal:open"));
  }

  if (!hasKeys) {
    return (
      <Paper p="md" withBorder>
        <Group justify="space-between" wrap="wrap">
          <Group>
            <IconLock size={16} />
            <span>{t("messages.composer.unlockFirst")}</span>
          </Group>
          <Group gap="xs">
            {keystoreOnDisk === true && (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconLock size={14} />}
                onClick={openUnlockModal}
              >
                {t("messages.composer.unlockButton")}
              </Button>
            )}
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconSettings size={14} />}
              onClick={() => navigate("/create-keystore")}
            >
              {t("messages.composer.setupKeyButton")}
            </Button>
          </Group>
        </Group>
      </Paper>
    );
  }

  return (
    <Paper p="sm" withBorder>
      {reply !== undefined && (
        <Paper withBorder p="xs" mb="xs">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <div>
              <Text size="xs" c="dimmed">
                {t("messages.reply", { defaultValue: "Reply" })} · {reply.sender.slice(0, 8)}
              </Text>
              <Text size="sm" lineClamp={2}>
                {reply.preview.length > 0
                  ? reply.preview
                  : t("messages.originalUnavailable", {
                      defaultValue: "Original message unavailable",
                    })}
              </Text>
            </div>
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label={t("messages.replyCancel", { defaultValue: "Cancel reply" })}
              onClick={() => clearReply(chatId)}
            >
              <IconX size={14} />
            </ActionIcon>
          </Group>
        </Paper>
      )}
      <Group align="flex-end" gap="xs">
        <Textarea
          ref={textareaRef}
          placeholder={
            disabledReason !== undefined
              ? t("messages.composer.disabledPlaceholder")
              : t("messages.composer.placeholder")
          }
          value={text}
          onChange={(e) => handleTextChange(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          autosize
          minRows={1}
          maxRows={6}
          style={{ flex: 1 }}
          disabled={disabledReason !== undefined}
        />
        <Tooltip label={t("messages.composer.sendTooltip")}>
          <ActionIcon
            size="lg"
            variant="filled"
            onClick={() => void handleSend()}
            disabled={disabledReason !== undefined || !text.trim() || send.isPending}
            loading={send.isPending}
          >
            <IconSend size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {sendError !== null && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={16} />}
          mt="xs"
          withCloseButton
          onClose={() => setSendError(null)}
        >
          {sendError}
        </Alert>
      )}
    </Paper>
  );
}
