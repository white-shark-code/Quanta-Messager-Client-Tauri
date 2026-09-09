import { Button, Center, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function EmptyChatsState() {
  const { t } = useTranslation();
  return (
    <Center mih={300} p="md">
      <Stack align="center" gap="md">
        <Text size="lg" c="dimmed">
          {t("chats.empty")}
        </Text>
        <Button component={Link} to="/chats/new">
          {t("chats.startNew")}
        </Button>
      </Stack>
    </Center>
  );
}
