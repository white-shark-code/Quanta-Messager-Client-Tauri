import { jsx as _jsx } from "react/jsx-runtime";
import { Badge } from "@mantine/core";
import { useEventsPolling } from "@/features/events/polling";
export function UnreadBadge({ chatId }) {
    const { data: events } = useEventsPolling();
    if (!events)
        return null;
    const total = events.dialog
        .filter((event) => event.chat_id === chatId)
        .reduce((sum, event) => sum + event.count, 0);
    if (total === 0)
        return null;
    return (_jsx(Badge, { color: "blue", variant: "filled", size: "sm", circle: true, children: total > 99 ? "99+" : total }));
}
export function GlobalUnreadCount() {
    const { data } = useEventsPolling();
    const total = (data?.dialog ?? []).reduce((sum, event) => sum + event.count, 0) +
        (data?.group ?? []).reduce((sum, event) => sum + event.count, 0);
    if (total === 0)
        return null;
    return (_jsx(Badge, { color: "blue", variant: "filled", size: "sm", circle: true, children: total > 99 ? "99+" : total }));
}
