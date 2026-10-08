/**
 * Static capability gate for Web Push (plan B).
 *
 * Returns `true` only when the platform exposes the APIs a push
 * subscription needs: Service Workers and `PushManager`. This is a
 * *necessary but not sufficient* check — e.g. ungoogled-chromium
 * exposes both APIs yet can never complete `PushManager.subscribe()`
 * (no vendor keys), which surfaces later as `subscribe-failed` from
 * `ensurePushSubscription()` (bounded by its own timeout, never wedged).
 *
 * No detection is perfect here: there is no API that reports "the vendor
 * push service is reachable". So the UI hides the switch only when the
 * APIs are missing, and otherwise relies on the subscribe attempt result.
 */
export function isPushApiAvailable(): boolean {
  try {
    const serviceWorker = globalThis.navigator?.serviceWorker;
    if (typeof serviceWorker === "undefined") {
      return false;
    }
    return typeof PushManager !== "undefined";
  } catch {
    return false;
  }
}
