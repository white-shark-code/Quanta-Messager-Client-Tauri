import { Button, Group, Paper, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { useForwardStore } from "../forwardStore";

/**
 * Compact bar above the composer while forward selection is active.
 * Proceed opens the target picker; Cancel clears this chat's selection.
 */
export function ForwardBar({
  chatId,
  onProceed,
}: {
  chatId: string;
  onProceed: () => void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const selection = useForwardStore((s) => s.selection[chatId] ?? []);
  const clearSelection = useForwardStore((s) => s.clearSelection);
  if (selection.length === 0) return null;
  return (
    <Paper withBorder p="xs" mx="sm">
      <Group justify="space-between" gap="xs">
        <Text size="sm">
          {t("messages.forwardSelected", {
            count: selection.length,
            defaultValue: "Forward ({{count}})",
          })}
        </Text>
        <Group gap="xs">
          <Button variant="subtle" size="xs" onClick={() => clearSelection(chatId)}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button size="xs" onClick={onProceed}>
            {t("messages.forwardTo", { defaultValue: "Forward to…" })}
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
