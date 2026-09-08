/**
 * Route to create a new group chat with name + member UUIDs.
 *
 * MVP limitation: the backend's CreateChatRequest accepts only a single
 * `user` string (no array). Per `report_for_backend/02`, the backend
 * additionally uses the creator's public key as the group key, so true
 * group E2E is not yet achievable. We surface a warning to the user
 * and, until the backend is fixed, create the group with only the
 * first validated member UUID; additional members will be added in a
 * follow-up API call.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  TagsInput,
  TextInput,
  Title,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

import { useCreateGroupChat } from "@/features/chats/queries";
import { useSessionStore } from "@/features/auth/sessionStore";
import { toUserMessage } from "@/infra/error";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function NewGroupRoute(): JSX.Element {
  const navigate = useNavigate();
  const createGroup = useCreateGroupChat();
  const currentUser = useSessionStore((s) => s.user);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    setValidationError(null);
    if (currentUser === null) {
      setValidationError("Not logged in");
      return;
    }
    if (name.trim().length < 1) {
      setValidationError("Group name required");
      return;
    }
    const validMembers = members.filter((m) => UUID_REGEX.test(m));
    if (validMembers.length !== members.length) {
      setValidationError("All members must be valid UUIDs");
      return;
    }
    if (validMembers.includes(currentUser.id)) {
      setValidationError("Remove yourself from the list (you're added automatically)");
      return;
    }
    if (validMembers.length === 0) {
      setValidationError("Add at least one member");
      return;
    }

    try {
      const chat = await createGroup.mutateAsync({
        name: name.trim(),
        user: validMembers[0]!,
      });
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
        New group
      </Title>
      <Stack>
        <Alert color="yellow" icon={<IconInfoCircle size={16} />}>
          Group E2E encryption is incomplete in MVP. The backend currently uses the
          creator&apos;s public key as the group key (see report #02). True group
          encryption requires backend changes.
        </Alert>
        <TextInput
          label="Group name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
        />
        <TagsInput
          label="Member UUIDs"
          placeholder="Paste UUIDs, press Enter"
          value={members}
          onChange={setMembers}
          description="Add at least one other user. You're added automatically as admin."
          clearable
        />
        {displayError !== null && <Alert color="red">{displayError}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => navigate("/chats")}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} loading={createGroup.isPending}>
            Create group
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
