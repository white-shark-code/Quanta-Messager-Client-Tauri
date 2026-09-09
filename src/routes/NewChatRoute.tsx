/**
 * Route to create a new private (1-to-1) dialog by entering the peer user's UUID.
 *
 * MVP intentionally has no email/username search — the backend exposes no
 * directory endpoint (see `report_for_backend/01`), so the user must paste
 * a UUID obtained out of band. Client-side validates UUID format and
 * blocks self-chat before sending the request.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { useCreatePrivateChat } from "@/features/chats/queries";
import { useSessionStore } from "@/features/auth/sessionStore";
import { toUserMessage } from "@/infra/error";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function NewChatRoute(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createChat = useCreatePrivateChat();
  const currentUser = useSessionStore((s) => s.user);
  const [name, setName] = useState("");
  const [peerUuid, setPeerUuid] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    setValidationError(null);
    if (currentUser === null) {
      setValidationError(t("chats.newChat.errors.notLoggedIn"));
      return;
    }
    if (peerUuid === currentUser.id) {
      setValidationError(t("chats.newChat.errors.selfChat"));
      return;
    }
    if (!UUID_REGEX.test(peerUuid)) {
      setValidationError(t("chats.newChat.errors.invalidUuid"));
      return;
    }
    try {
      const chat = await createChat.mutateAsync({
        name: name.length > 0 ? name : `Chat with ${peerUuid.slice(0, 8)}`,
        user: peerUuid,
      });
      navigate(`/chats/${chat.id}`, { replace: true });
    } catch {
      // mutation.error will surface in the JSX below
    }
  }

  const displayError = validationError ?? (createChat.error !== null ? toUserMessage(createChat.error) : null);

  return (
    <Paper p="md" maw={500} mx="auto" mt={40}>
      <Title order={2} mb="md">
        {t("chats.newChat.title")}
      </Title>
      <Stack>
        <Text size="sm" c="dimmed">
          {t("chats.newChat.description")}
        </Text>
        <TextInput
          label={t("chats.newChat.peerUuidLabel")}
          placeholder={t("chats.newChat.peerUuidPlaceholder")}
          value={peerUuid}
          onChange={(e) => setPeerUuid(e.currentTarget.value)}
          required
        />
        <TextInput
          label={t("chats.newChat.chatNameLabel")}
          placeholder={t("chats.newChat.chatNamePlaceholder")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        {displayError !== null && <Alert color="red">{displayError}</Alert>}
        <Button onClick={() => void handleSubmit()} loading={createChat.isPending}>
          {t("chats.newChat.submit")}
        </Button>
      </Stack>
    </Paper>
  );
}