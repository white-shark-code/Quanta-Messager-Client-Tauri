import { Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { jumpToMessage } from "../jumpToMessage";
import type { ForwardRef } from "../replyEnvelope";

/**
 * Small dimmed "Forwarded" line rendered above forwarded message text.
 *
 * Clickable only when the origin chat is the current one (jumps to the
 * source message via {@link jumpToMessage}); otherwise plain
 * non-interactive text.
 */
export function ForwardedMarker({
  forwarded,
  chatId,
}: {
  forwarded: ForwardRef;
  chatId: string;
}): JSX.Element {
  const { t } = useTranslation();
  const label = t("messages.forwardedLabel", { defaultValue: "Forwarded" });
  if (forwarded.fromChat === chatId) {
    return (
      <Text
        size="xs"
        c="dimmed"
        fs="italic"
        role="button"
        tabIndex={0}
        aria-label={label}
        style={{ cursor: "pointer" }}
        onClick={() => jumpToMessage(forwarded.fromMsg)}
        onKeyDown={(e) => {
          if (e.key === "Enter") jumpToMessage(forwarded.fromMsg);
        }}
      >
        {label}
      </Text>
    );
  }
  return (
    <Text size="xs" c="dimmed" fs="italic">
      {label}
    </Text>
  );
}
