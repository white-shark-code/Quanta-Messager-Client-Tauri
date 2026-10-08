import { useCallback, useState } from "react";

import { useSettingsStore } from "@/features/settings/settingsStore";
import { ensureNotificationPermission } from "@/infra/tauriBridge";

import { ensurePushSubscription, unsubscribePushSubscription } from "./subscription";

export interface PushToggleResult {
  ok: boolean;
  reason?: string;
}

export interface UsePushToggle {
  pushEnabled: boolean;
  pending: boolean;
  /** Last failure reason (`"denied"`, `"no-vapid"`, …) or `null` on success. */
  reason: string | null;
  togglePush: (enabled: boolean) => Promise<PushToggleResult>;
}

function toReason(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) {
    return err.message;
  }
  if (typeof err === "string" && err.length > 0) {
    return err;
  }
  return "unknown";
}

/**
 * Settings UI switch for Web Push (B2).
 *
 * Enable: `ensureNotificationPermission()` first (Tauri-guarded inside —
 * in plain browser dev it resolves `true` and the real gate is the
 * `Notification.permission` check in `ensurePushSubscription`). A denial
 * returns `{ok: false, reason: "denied"}` WITHOUT writing `pushEnabled`;
 * otherwise the subscription result decides the persisted value
 * (`true` on `{subscribed: true}`, `false` with the B1 reason otherwise).
 *
 * Disable: `unsubscribePushSubscription()` (best-effort, idempotent in B1)
 * then persist `pushEnabled: false`.
 *
 * Never throws into the UI — every failure surfaces as
 * `{ok: false, reason}` and is kept in `reason` for the helper text
 * under the switch.
 */
export function usePushToggle(): UsePushToggle {
  const pushEnabled = useSettingsStore((s) => s.pushEnabled);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  const togglePush = useCallback(async (enabled: boolean): Promise<PushToggleResult> => {
    setPending(true);
    try {
      if (enabled) {
        let granted: boolean;
        try {
          granted = await ensureNotificationPermission();
        } catch (err: unknown) {
          const r = toReason(err);
          setReason(r);
          return { ok: false, reason: r };
        }
        if (!granted) {
          setReason("denied");
          return { ok: false, reason: "denied" };
        }
        let subscribed = false;
        let failureReason = "unknown";
        try {
          const res = await ensurePushSubscription();
          if (res.subscribed) {
            subscribed = true;
          } else {
            failureReason = res.reason;
          }
        } catch (err: unknown) {
          failureReason = toReason(err);
        }
        await useSettingsStore.getState().set("pushEnabled", subscribed);
        if (subscribed) {
          setReason(null);
          return { ok: true };
        }
        setReason(failureReason);
        return { ok: false, reason: failureReason };
      }
      try {
        await unsubscribePushSubscription();
      } catch (err: unknown) {
        const r = toReason(err);
        setReason(r);
        return { ok: false, reason: r };
      }
      await useSettingsStore.getState().set("pushEnabled", false);
      setReason(null);
      return { ok: true };
    } finally {
      setPending(false);
    }
  }, []);

  return { pushEnabled, pending, reason, togglePush };
}
