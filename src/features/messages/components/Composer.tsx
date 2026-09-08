import { useRef, type KeyboardEvent } from "react";
import { ActionIcon, Group, Paper, Textarea, Tooltip } from "@mantine/core";
import { IconLock, IconSend } from "@tabler/icons-react";

import { useKeyringStore } from "@/features/keyring/keyringStore";

import { useComposerStore } from "../composerStore";
import { useSendGroupMessage, useSendPrivateMessage } from "../mutations";

export interface ComposerProps {
  chatId: string;
  kind?: "private" | "group";
}

export function Composer({ chatId, kind = "private" }: ComposerProps) {
  const text = useComposerStore((s) => s.drafts[chatId]?.text ?? "");
  const setText = useComposerStore((s) => s.setText);
  const clearDraft = useComposerStore((s) => s.clearDraft);
  const sendPrivate = useSendPrivateMessage(chatId);
  const sendGroup = useSendGroupMessage(chatId);
  const send = kind === "private" ? sendPrivate : sendGroup;
  const hasKeys = useKeyringStore((s) => s.privateKey !== null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  async function handleSend() {
    if (!text.trim()) return;
    const currentText = text;
    await send.mutateAsync({ chatId, text: currentText });
    clearDraft(chatId);
    textareaRef.current?.focus();
  }

  if (!hasKeys) {
    return (
      <Paper p="md">
        <Group>
          <IconLock size={16} />
          <span>Unlock to send messages</span>
        </Group>
      </Paper>
    );
  }

  return (
    <Paper p="sm" withBorder>
      <Group align="flex-end" gap="xs">
        <Textarea
          ref={textareaRef}
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(chatId, e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          autosize
          minRows={1}
          maxRows={6}
          style={{ flex: 1 }}
        />
        <Tooltip label="Send (Enter)">
          <ActionIcon
            size="lg"
            variant="filled"
            onClick={() => void handleSend()}
            disabled={!text.trim() || send.isPending}
            loading={send.isPending}
          >
            <IconSend size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  );
}