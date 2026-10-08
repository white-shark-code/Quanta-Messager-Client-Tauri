import { useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { getAccessToken } from "@/features/auth/accessToken";
import { useSessionStore } from "@/features/auth/sessionStore";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { invalidateMessages } from "@/features/messages/queries";
import { notify, onAppEvent } from "@/infra/tauriBridge";
import { debugLog } from "@/lib/debug";
import i18n from "@/i18n";

import { createEventsSocket, type WsInbound, type WsStatus } from "./socket";
import { buildWsUrlFromEnv } from "./wsUrl";
import { setWsStatus } from "./wsStatusStore";

export interface UseEventsSocketOptions {
  /** Master switch for tests / previews. Defaults to `true`. */
  enabled?: boolean;
}

/**
 * True when the given chat's route is currently visible.
 *
 * Pure `window.location` check (no router import — this module must stay
 * usable outside `<RouterProvider>` and in unit tests): the chat route is
 * `/chats/:chatId` (see `ChatRoute`), so a pathname containing the id
 * means the user is already looking at the conversation.
 */
function isChatOpen(chatId: string): boolean {
  try {
    if (typeof window === "undefined" || typeof window.location === "undefined") {
      return false;
    }
    return window.location.pathname.includes(chatId);
  } catch {
    return false;
  }
}

/**
 * Decide whether an inbound `new_*` frame deserves an OS notification:
 * notifications on, and the user is NOT already looking at that chat
 * (background tab/app, or a different route open).
 *
 * The body never contains plaintext or ids — just a generic "new
 * message" line (see `events.newMessage`).
 */
function shouldNotify(chatId: string): boolean {
  if (useSettingsStore.getState().notificationsEnabled !== true) {
    return false;
  }
  if (typeof document !== "undefined" && document.hidden) {
    return true;
  }
  return !isChatOpen(chatId);
}

function notifyNewMessage(): void {
  const body = i18n.t("events.newMessage", { defaultValue: "Новое сообщение" });
  void notify("Quant", body).catch((err: unknown) => {
    void debugLog("events.notify", err);
  });
}

/**
 * Handle one inbound WS frame: refresh the unread-badge list (`["events"]`),
 * the affected chat's message pages, and the chat lists (`["chats"]` prefix
 * covers `["chats", "private"]`, `["chats", "group"]` and per-chat keys).
 * Every other frame type is ignored (the socket layer already `debugLog`s
 * unknown types).
 *
 * After invalidation, `new_*` frames trigger an Android-safe OS
 * notification via `tauriBridge.notify` (isTauri-guarded,
 * plugin-notification under the hood) unless the user disabled
 * notifications or is already viewing the chat. Notify errors go to
 * `debugLog` and never break the invalidate path.
 */
function handleInbound(queryClient: QueryClient, m: WsInbound): void {
  if (m.type !== "new_dialog_message" && m.type !== "new_group_message") {
    return;
  }
  const kind = m.type === "new_dialog_message" ? "private" : "group";
  const chatId = (m as { chat_id?: unknown }).chat_id;
  void queryClient.invalidateQueries({ queryKey: ["events"] });
  if (typeof chatId !== "string" || chatId.length === 0) {
    return;
  }
  void invalidateMessages(queryClient, chatId, kind);
  void queryClient.invalidateQueries({ queryKey: ["chats"] });
  if (shouldNotify(chatId)) {
    notifyNewMessage();
  }
}

/**
 * Session-scoped realtime socket for the events channel (`/event/ws`, T4).
 *
 * The socket exists only while `isUnlocked && realtimeMode === "ws" &&
 * opts.enabled`. Otherwise no socket is created and the hook reports
 * `"idle"` (never connected) or `"closed"` (after a `close()` on lock).
 *
 * The effect re-creates the socket when the token snapshot, `isUnlocked`
 * or `realtimeMode` changes; `close()` runs on cleanup / lock. Reconnect
 * triggers: `window` online, `document` visible, and Tauri `resumed` /
 * `focus` app events (guarded by `__TAURI_INTERNALS__`, unlistened on
 * cleanup).
 *
 * NOTE: OS notifications for `new_*` frames are sent from
 * `handleInbound` (T5) via `tauriBridge.notify`.
 */
export function useEventsSocket(opts?: UseEventsSocketOptions): WsStatus {
  const isUnlocked = useSessionStore((s) => s.isUnlocked);
  const realtimeMode = useSettingsStore((s) => s.realtimeMode);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WsStatus>("idle");

  const enabled = opts?.enabled ?? true;
  const active = isUnlocked && realtimeMode === "ws" && enabled;
  // Non-reactive module token read as an effect dep: `setAccessToken` is
  // always followed by a session-store transition (which re-renders), so
  // the fresh token is picked up when the socket (re)connects.
  const token = isUnlocked ? getAccessToken() : null;

  useEffect(() => {
    if (!active) {
      return;
    }
    const socket = createEventsSocket({
      getToken: getAccessToken,
      buildUrl: buildWsUrlFromEnv,
      onMessage: (m) => handleInbound(queryClient, m),
      onStatus: (s) => {
        setStatus(s);
        setWsStatus(s);
      },
      onUnauthorized: () => useSessionStore.getState().lock(),
    });

    const handleOnline = (): void => socket.reconnect();
    const handleVisibility = (): void => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        socket.reconnect();
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    let cancelled = false;
    const unlistens: UnlistenFn[] = [];
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      void onAppEvent("resumed", () => socket.reconnect()).then((u) => {
        if (cancelled) {
          u();
        } else {
          unlistens.push(u);
        }
      });
      void onAppEvent("focus", () => socket.reconnect()).then((u) => {
        if (cancelled) {
          u();
        } else {
          unlistens.push(u);
        }
      });
    }

    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
      for (const u of unlistens) {
        u();
      }
      unlistens.length = 0;
      socket.close();
    };
  }, [active, token, queryClient]);

  return status;
}
