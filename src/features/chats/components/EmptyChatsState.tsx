import { Button, Center, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { BrandMark } from "@/ui/components/BrandLogo";

export function EmptyChatsState() {
  const { t } = useTranslation();
  return (
    <Center mih={300} p="md">
      <Stack align="center" gap="md">
        <BrandMark size={72} color="var(--mantine-color-gray-4)" title="" />
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
