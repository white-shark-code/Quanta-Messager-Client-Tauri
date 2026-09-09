import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { useCreateGroupChat } from "@/features/chats/queries";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { toUserMessage } from "@/infra/error";

/**
 * Backend refactor (per backend report #02 follow-up):
 * - POST /group-messages/group-chat/ now accepts `{name, public_key}` (no member list)
 * - Backend automatically adds the creator as ADMIN in `user_groups` (via
 *   `GroupChatFacade._after_create` hook).
 * - Member management will come via a separate API later (see report_for_backend/02).
 *
 * For MVP we use the creator's own public key as the group key — true group
 * E2E requires backend changes (see report_for_backend/02).
 */
export function NewGroupRoute(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createGroup = useCreateGroupChat();
  const hasPublicKey = useKeyringStore((s) => s.publicKeyArmored !== null);
  const [name, setName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    setValidationError(null);
    if (hasPublicKey === false) {
      setValidationError(t("chats.newGroup.errors.needKeyFirst"));
      return;
    }
    if (name.trim().length < 1) {
      setValidationError(t("chats.newGroup.errors.nameRequired"));
      return;
    }
    try {
      const chat = await createGroup.mutateAsync({ name: name.trim() });
      navigate(`/chats/${chat.id}`, { replace: true });
    } catch {
      // mutation.error will surface in the JSX below
    }
  }

  const displayError =
    validationError ??
    (createGroup.error !== null ? toUserMessage(createGroup.error) : null);

  return (
    <Paper p="md" maw={600} mx="auto" mt={40}>
      <Title order={2} mb="md">
        {t("chats.newGroup.title")}
      </Title>
      <Stack>
        <Alert color="yellow" icon={<IconInfoCircle size={16} />}>
          {t("chats.newGroup.e2eWarning")}
        </Alert>
        <TextInput
          label={t("chats.newGroup.nameLabel")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
        />
        {displayError !== null && <Alert color="red">{displayError}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => navigate("/chats")}>
            {t("chats.newGroup.cancel")}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            loading={createGroup.isPending}
          >
            {t("chats.newGroup.submit")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}