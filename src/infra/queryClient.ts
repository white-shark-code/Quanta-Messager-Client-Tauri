import { QueryClient } from "@tanstack/react-query";

/**
 * Singleton `QueryClient` for the Quant Messenger frontend.
 *
 * **Per-query-key staleTime convention** (overridden by individual `useQuery` calls
 * where appropriate; defaults here act as a safety net for any unconfigured query):
 *
 * | Query key | `staleTime` | Refetch strategy |
 * | --- | --- | --- |
 * | `["me"]` | `Infinity` | Manual invalidation on logout / profile update |
 * | `["chats"]` | `30_000` (30 s) | Manual refresh + on new events |
 * | `["messages", chatId, cursor]` | `0` | Polling while chat is open |
 * | `["events"]` | `0` | 5 s polling (see `useEventsPolling`) |
 *
 * Default `staleTime` is `30_000` ms — most queries are short-lived server data,
 * and `stale-while-revalidate` UX shows cached data instantly while a background
 * fetch reconciles.
 *
 * `networkMode: "always"` ensures queries fire even when the browser reports
 * `navigator.onLine === false`; the Tauri WebView can ship with that flag stuck
 * to `false` on Android after backgrounding.
 *
 * `refetchOnWindowFocus: false` is intentional: real-time is driven by the
 * `/event/*` polling hook, not by window-focus heuristics.
 *
 * Retry strategy: exponential backoff capped at 30 s, max 1 retry by default
 * (mutations never auto-retry — they require an explicit user action).
 *
 * @example
 * ```ts
 * import { QueryClientProvider } from "@tanstack/react-query";
 * import { queryClient } from "@/infra/queryClient";
 *
 * <QueryClientProvider client={queryClient}>...</QueryClientProvider>
 * ```
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      networkMode: "always",
    },
    mutations: {
      retry: 0,
    },
  },
});