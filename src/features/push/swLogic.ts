/**
 * Pure helpers for the Web Push flow.
 *
 * The push payload carries IDs only (`type`, `chat_id`, `message_id`) —
 * no names or ciphertext, because pushes travel via third-party servers.
 * The live UI renders the real message content; the Service Worker only
 * shows a generic "Новое сообщение" text.
 *
 * `public/sw.js` intentionally stays bundler-free, so it cannot import
 * this module — it carries an inlined mirror of the logic below.
 */

export const KNOWN_PUSH_TYPES = ["new_dialog_message", "new_group_message"] as const;

export type PushMessageType = (typeof KNOWN_PUSH_TYPES)[number];

export interface PushNotificationData {
  chat_id: string;
  url: string;
}

export interface PushNotification {
  title: string;
  body: string;
  tag: string;
  data: PushNotificationData;
}

export function isKnownPushType(type: unknown): type is PushMessageType {
  return type === "new_dialog_message" || type === "new_group_message";
}

function toIdString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * Build notification content for a raw push payload.
 * Returns `null` for unknown `type` values or payloads without usable
 * `chat_id` / `message_id` — the caller must not show anything then.
 */
export function notificationForPayload(payload: unknown): PushNotification | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as { type?: unknown; chat_id?: unknown; message_id?: unknown };
  if (!isKnownPushType(record.type)) {
    return null;
  }
  const chatId = toIdString(record.chat_id);
  const messageId = toIdString(record.message_id);
  if (chatId === null || messageId === null) {
    return null;
  }
  return {
    title: "Quant",
    body: "Новое сообщение",
    tag: messageId,
    data: { chat_id: chatId, url: `/chats/${chatId}` },
  };
}

export interface VisibilityClient {
  visibilityState: string;
}

/**
 * Decide whether the Service Worker should show a notification.
 * When any client (tab) is visible, the live UI already renders the
 * message via `useEventsSocket` — showing a system notification as well
 * would duplicate it. Returns `true` only when no client is visible.
 */
export function shouldShowNotification(clients: readonly VisibilityClient[]): boolean {
  return !clients.some((client) => client.visibilityState === "visible");
}
