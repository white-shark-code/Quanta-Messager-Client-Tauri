import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { useSessionStore } from "@/features/auth/sessionStore";
import { usePrivateChats } from "@/features/chats/queries";
import type { DialogChat } from "@/features/chats/model";
import { getUserPublicKey } from "@/features/users/api";
import { toUserMessage } from "@/infra/error";

import { useForwardStore } from "../forwardStore";
import type { ChatKind } from "../mutations";
import { runForwardToTarget } from "../runForward";

/**
 * For a 1:1 dialog, the peer is whichever of `user0` / `user1` isn't us
 * (mirrors `ChatRoute`'s peer logic). `undefined` when undeterminable.
 */
function pickPeerId(
  chat: DialogChat | undefined,
  currentUserId: string | undefined,
): string | undefined {
  if (chat === undefined || currentUserId === undefined) return undefined;
  return chat.user0 === currentUserId ? chat.user1 : chat.user0;
}

export interface ForwardTargetPickerProps {
  opened: boolean;
  onClose: () => void;
  sourceChatId: string;
  sourceKind: ChatKind;
  messageIds: string[];
}

/**
 * Right-side drawer listing private chats as forward destinations.
 * Picking a row resolves the target peer key, forwards, then navigates
 * to the target chat. Stays open with an inline error when nothing was
 * sent or the send failed.
 */
export function ForwardTargetPicker({
  opened,
  onClose,
  sourceChatId,
  sourceKind,
  messageIds,
}: ForwardTargetPickerProps): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useSessionStore((s) => s.user);
  const setTarget = useForwardStore((s) => s.setTarget);
  const clearAll = useForwardStore((s) => s.clearAll);
  const clearTarget = useForwardStore((s) => s.clearTarget);

  const chatsQuery = usePrivateChats();
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const chats = useMemo<DialogChat[]>(() => {
    const all = chatsQuery.data?.pages.flatMap((p) => p.items) ?? [];
    const q = filter.trim().toLowerCase();
    return all.filter(
      (c) => c.id !== sourceChatId && (q.length === 0 || c.name.toLowerCase().includes(q)),
    );
  }, [chatsQuery.data, filter, sourceChatId]);

  function handleClose(): void {
    setBusyId(null);
    setError(null);
    setWarning(null);
    onClose();
  }

  async function handlePick(chat: DialogChat): Promise<void> {
    if (busyId !== null) return;
    setBusyId(chat.id);
    setError(null);
    setWarning(null);
    try {
      const peerId = pickPeerId(chat, currentUser?.id);
      let armor: string | null = null;
      if (peerId !== undefined) {
        const key = await getUserPublicKey(peerId);
        armor = key.has_public_key ? key.public_key : null;
      }
      const result = await runForwardToTarget({
        queryClient,
        sourceChatId,
        sourceKind,
        targetChatId: chat.id,
        targetKind: "private",
        targetPeerKeyArmored: armor,
        messageIds,
        setTarget,
      });
      if (result.sent.length === 0) {
        setError(
          t("messages.forwardSkipped", {
            count: result.skipped.length,
            defaultValue: "{{count}} skipped",
          }),
        );
        setBusyId(null);
        return;
      }
      if (result.skipped.length > 0) {
        setWarning(
          t("messages.forwardSkipped", {
            count: result.skipped.length,
            defaultValue: "{{count}} skipped",
          }),
        );
      }
      clearAll();
      clearTarget();
      handleClose();
      navigate(`/chats/${chat.id}`);
    } catch (e) {
      setError(toUserMessage(e));
      setBusyId(null);
    }
  }

  return (
    <Drawer
      position="right"
      opened={opened}
      onClose={handleClose}
      title={t("messages.forwardTo", { defaultValue: "Forward to…" })}
    >
      <Stack gap="xs">
        <TextInput
          placeholder={t("messages.forwardSearch", { defaultValue: "Search chats" })}
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
        {error !== null && <Alert color="red">{error}</Alert>}
        {warning !== null && <Alert color="yellow">{warning}</Alert>}
        {chats.map((chat) => (
          <UnstyledButton
            key={chat.id}
            disabled={busyId !== null}
            onClick={() => void handlePick(chat)}
            aria-label={chat.name}
            style={{ width: "100%" }}
          >
            <Group justify="space-between" gap="xs">
              <Text size="sm">{chat.name}</Text>
              {busyId === chat.id && <Loader size={14} />}
            </Group>
          </UnstyledButton>
        ))}
        {chats.length === 0 && (
          <Text size="sm" c="dimmed">
            {t("messages.forwardNoChats", { defaultValue: "No chats found" })}
          </Text>
        )}
      </Stack>
    </Drawer>
  );
}
