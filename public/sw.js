/* Quant Web Push Service Worker (plain script, no bundler).
 *
 * NOTE: mirror of `src/features/push/swLogic.ts` — the ~10 lines of
 * decision logic below are intentionally duplicated inline because a
 * Service Worker cannot import TS modules without a bundler step.
 * Keep the two in sync: known `type` values, generic body text,
 * `tag: message_id`, `data: { chat_id, url: "/chats/<id>" }`, and the
 * visible-client dedup rule.
 */

/* global self: readonly, URL: readonly */

const KNOWN_PUSH_TYPES = ["new_dialog_message", "new_group_message"];

// Mirror of notificationForPayload() in swLogic.ts.
function notificationForPayload(payload) {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  if (!KNOWN_PUSH_TYPES.includes(payload.type)) {
    return null;
  }
  const chatId =
    (typeof payload.chat_id === "string" && payload.chat_id.length > 0 && payload.chat_id) ||
    (typeof payload.chat_id === "number" && Number.isFinite(payload.chat_id)
      ? String(payload.chat_id)
      : null);
  const messageId =
    (typeof payload.message_id === "string" &&
      payload.message_id.length > 0 &&
      payload.message_id) ||
    (typeof payload.message_id === "number" && Number.isFinite(payload.message_id)
      ? String(payload.message_id)
      : null);
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

// Mirror of shouldShowNotification() in swLogic.ts.
function shouldShowNotification(clients) {
  return !clients.some((client) => client.visibilityState === "visible");
}

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  const notification = notificationForPayload(payload);
  if (notification === null) {
    return;
  }
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window" });
      // A visible tab renders the message via useEventsSocket already —
      // skip the system notification to avoid a duplicate.
      if (!shouldShowNotification(clients)) {
        return;
      }
      await self.registration.showNotification(notification.title, {
        body: notification.body,
        tag: notification.tag,
        data: notification.data,
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const url =
    data !== null && typeof data === "object" && typeof data.url === "string" && data.url !== ""
      ? data.url
      : "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        try {
          if (new URL(client.url).pathname === url && typeof client.focus === "function") {
            await client.focus();
            return;
          }
        } catch {
          // Ignore unparsable client URLs and keep looking.
        }
      }
      for (const client of clients) {
        if (typeof client.navigate === "function" && typeof client.focus === "function") {
          await client.navigate(url);
          await client.focus();
          return;
        }
      }
      if (typeof self.clients.openWindow === "function") {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
