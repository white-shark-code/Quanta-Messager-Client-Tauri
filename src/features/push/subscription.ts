import { getMeta, subscribePush, unsubscribePush } from "./api";

export type EnsurePushReason =
  | "denied"
  | "no-service-worker"
  | "no-push-manager"
  | "no-vapid"
  | "no-keys"
  | "subscribe-failed";

export type EnsurePushResult =
  | { subscribed: true; endpoint: string }
  | { subscribed: false; reason: EnsurePushReason };

export type UnsubscribePushResult =
  | { unsubscribed: true; endpoint: string }
  | { unsubscribed: false; reason: "no-service-worker" | "no-subscription" };

/**
 * Decode a URL-safe base64 VAPID public key into bytes for
 * `PushManager.subscribe({ applicationServerKey })`.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (padded.length % 4)) % 4;
  const normalized = padded + "=".repeat(padding);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string | null {
  if (buffer === null) {
    return null;
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Upper bound for `pushManager.subscribe()` (vendor network round-trip). */
const SUBSCRIBE_TIMEOUT_MS = 30_000;

/**
 * Race a promise against a timeout. The vendor push-service call has no
 * timeout of its own; without this a stalled network wedges the caller
 * (and the settings toggle) in `pending` forever.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Ensure a Web Push subscription exists and is registered on the backend.
 *
 * Flow: `Notification.permission === "granted"` → Service Worker ready →
 * VAPID key from `GET /meta` (empty → `{subscribed: false,
 * reason: "no-vapid"}`) → reuse `getSubscription()` or create one via
 * `subscribe({ userVisibleOnly: true, applicationServerKey })` → send the
 * endpoint + keys to `POST /push/subscribe`.
 *
 * No React imports — plain async helpers callable from any UI layer.
 */
export async function ensurePushSubscription(): Promise<EnsurePushResult> {
  if (globalThis.Notification?.permission !== "granted") {
    return { subscribed: false, reason: "denied" };
  }
  const serviceWorker = globalThis.navigator?.serviceWorker;
  if (typeof serviceWorker === "undefined") {
    return { subscribed: false, reason: "no-service-worker" };
  }
  // `ready` only settles when a worker is registered for this scope —
  // nothing registers it for us (plain `public/sw.js`, no PWA plugin),
  // so register on demand. Absent in some WebViews (Tauri mobile) —
  // any failure maps to `no-service-worker`, never throws.
  try {
    const existing = await serviceWorker.getRegistration();
    if (!existing) {
      await serviceWorker.register("/sw.js");
    }
  } catch {
    return { subscribed: false, reason: "no-service-worker" };
  }
  let registration: ServiceWorkerRegistration;
  try {
    registration = await serviceWorker.ready;
  } catch {
    return { subscribed: false, reason: "no-service-worker" };
  }
  if (typeof registration.pushManager === "undefined") {
    return { subscribed: false, reason: "no-push-manager" };
  }
  const meta = await getMeta();
  const vapidKey = meta.vapid_public_key;
  if (typeof vapidKey !== "string" || vapidKey.length === 0) {
    return { subscribed: false, reason: "no-vapid" };
  }
  let subscription = await registration.pushManager.getSubscription();
  if (subscription === null) {
    // `pushManager.subscribe()` talks to the vendor push service and has
    // no timeout of its own — in broken environments (no network route,
    // unkeyed Chromium builds) it hangs forever and wedges the settings
    // toggle in `pending`. Bound it: a stall surfaces as `subscribe-failed`.
    try {
      subscription = await withTimeout(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }),
        SUBSCRIBE_TIMEOUT_MS,
      );
    } catch {
      return { subscribed: false, reason: "subscribe-failed" };
    }
  }
  if (subscription === null) {
    return { subscribed: false, reason: "subscribe-failed" };
  }
  const p256dh = arrayBufferToBase64Url(subscription.getKey("p256dh"));
  const auth = arrayBufferToBase64Url(subscription.getKey("auth"));
  if (p256dh === null || auth === null) {
    return { subscribed: false, reason: "no-keys" };
  }
  await subscribePush(subscription.endpoint, p256dh, auth);
  return { subscribed: true, endpoint: subscription.endpoint };
}

/**
 * Remove the push subscription: delete it on the backend first, then
 * unsubscribe locally. Idempotent — missing registration/subscription
 * yields `{unsubscribed: false}` instead of throwing.
 */
export async function unsubscribePushSubscription(): Promise<UnsubscribePushResult> {
  const serviceWorker = globalThis.navigator?.serviceWorker;
  if (typeof serviceWorker === "undefined") {
    return { unsubscribed: false, reason: "no-service-worker" };
  }
  let subscription: PushSubscription | null = null;
  try {
    const registration = await serviceWorker.getRegistration();
    subscription = (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    subscription = null;
  }
  if (subscription === null) {
    return { unsubscribed: false, reason: "no-subscription" };
  }
  const endpoint = subscription.endpoint;
  await unsubscribePush(endpoint);
  try {
    await subscription.unsubscribe();
  } catch {
    // Backend record is already gone; a local failure must not throw.
  }
  return { unsubscribed: true, endpoint };
}
