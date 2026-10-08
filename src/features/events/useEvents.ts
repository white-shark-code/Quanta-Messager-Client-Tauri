import { useQuery } from "@tanstack/react-query";

import { useSessionStore } from "@/features/auth/sessionStore";
import { useSettingsStore } from "@/features/settings/settingsStore";

import { getAllEvents } from "./api";
import { useEventsPolling } from "./polling";

/**
 * Facade over the two realtime transports (T4).
 *
 * - WS mode (`isUnlocked && realtimeMode === "ws"`): single `useQuery` on
 *   `["events"]` with NO `refetchInterval` — freshness comes from
 *   `useEventsSocket` invalidations (mounted in `AppShellRoute`).
 * - Otherwise: delegates to `useEventsPolling()` (legacy interval +
 *   visibility / Tauri pause handling, untouched).
 *
 * Both branches return the same `UseQueryResult` shape, so `ChatsRoute`,
 * `UnreadBadge` / `GlobalUnreadCount` and `useMarkAsRead` migrate with a
 * single import change.
 *
 * NOTE (simple variant): the branch is conditional, so hook order changes
 * when `realtimeMode` flips at runtime. Flips are rare (settings toggle)
 * and remount-safe in practice; a single-`useQuery` with conditional
 * `refetchInterval` would remove the caveat (possible T5 follow-up).
 */
export function useEvents() {
  const isUnlocked = useSessionStore((s) => s.isUnlocked);
  const realtimeMode = useSettingsStore((s) => s.realtimeMode);

  if (isUnlocked && realtimeMode === "ws") {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQuery({
      queryKey: ["events"],
      queryFn: () => getAllEvents(),
      enabled: isUnlocked,
      staleTime: 0,
    });
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useEventsPolling();
}
