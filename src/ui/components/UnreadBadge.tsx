import { Badge } from "@mantine/core";

import { useEvents } from "@/features/events/useEvents";

interface UnreadBadgeProps {
  chatId: string;
}

export function UnreadBadge({ chatId }: UnreadBadgeProps) {
  const { data: events } = useEvents();

  if (!events) return null;

  const total = events.dialog
    .filter((event) => event.chat_id === chatId)
    .reduce((sum, event) => sum + event.count, 0);

  if (total === 0) return null;

  return (
    <Badge color="blue" variant="filled" size="sm" circle>
      {total > 99 ? "99+" : total}
    </Badge>
  );
}

export function GlobalUnreadCount() {
  const { data } = useEvents();

  const total =
    (data?.dialog ?? []).reduce((sum, event) => sum + event.count, 0) +
    (data?.group ?? []).reduce((sum, event) => sum + event.count, 0);

  if (total === 0) return null;

  return (
    <Badge color="blue" variant="filled" size="sm" circle>
      {total > 99 ? "99+" : total}
    </Badge>
  );
}
