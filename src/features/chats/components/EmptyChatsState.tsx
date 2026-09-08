import { Button, Center, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";

export function EmptyChatsState() {
  return (
    <Center mih={300} p="md">
      <Stack align="center" gap="md">
        <Text size="lg" c="dimmed">
          No chats yet
        </Text>
        <Button component={Link} to="/chats/new">
          Start new chat
        </Button>
      </Stack>
    </Center>
  );
}
