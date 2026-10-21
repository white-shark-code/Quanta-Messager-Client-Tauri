/**
 * Full-screen boot splash — the brand mark above a spinner, shown while
 * the session / keystore state is still being resolved.
 *
 * Used by the root redirect and by `RequireAuth`; kept in one place so
 * every "we are still deciding where to send you" moment looks the same.
 */
import { Center, Loader, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { BrandMark } from "./BrandLogo";

export function BootSplash(): JSX.Element {
  const { t } = useTranslation();
  return (
    <Center mih="100vh">
      <Stack align="center" gap="sm">
        <BrandMark size={56} color="var(--mantine-color-quant-6)" title="" />
        <Loader size="md" />
        <Text c="dimmed" size="sm">
          {t("common.loadingSession")}
        </Text>
      </Stack>
    </Center>
  );
}
