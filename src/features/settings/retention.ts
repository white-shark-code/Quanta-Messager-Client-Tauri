/**
 * Retention sweep: periodic cleanup of old local dialog history and
 * media-vault entries, driven by the two retention settings.
 *
 * Both sweeps are local-only: server history is re-fetched on scroll and
 * evicted media is re-downloaded on view, so this is purely a disk-usage
 * control on the current device.
 */

import { useEffect, useRef } from "react";

import { useSessionStore } from "@/features/auth/sessionStore";
import { applyDialogRetention } from "@/features/dialog-store/store";
import { applyMediaRetention } from "@/features/media/vault";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { debugLog } from "@/lib/debug";

export interface RetentionSweepResult {
  msgsDeleted: number;
  mediaDeleted: number;
}

/** First automatic sweep runs shortly after mount (lets startup settle). */
const FIRST_RUN_DELAY_MS = 10_000;
/** Recurring sweep cadence. */
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Run one retention sweep for `userId` according to the current settings.
 * Returns `null` (and logs nothing) when both settings are `0` ("keep
 * forever"). Each domain is only touched when its own setting is > 0.
 * Never throws.
 */
export async function runRetentionSweep(userId: string): Promise<RetentionSweepResult | null> {
  const { chatRetentionDays, mediaRetentionDays } = useSettingsStore.getState();
  if (chatRetentionDays <= 0 && mediaRetentionDays <= 0) return null;

  const msgsDeleted =
    chatRetentionDays > 0 ? await applyDialogRetention(userId, chatRetentionDays) : 0;
  const mediaDeleted =
    mediaRetentionDays > 0 ? await applyMediaRetention(userId, mediaRetentionDays) : 0;

  const result: RetentionSweepResult = { msgsDeleted, mediaDeleted };
  void debugLog("retention.sweep", result);
  return result;
}

/** Guards against overlapping sweeps across timer ticks. */
let sweepInFlight = false;

/**
 * Session-scoped retention schedule: first sweep after
 * {@link FIRST_RUN_DELAY_MS}, then every {@link SWEEP_INTERVAL_MS}. A
 * change to either retention setting re-arms the schedule and runs a
 * sweep immediately. Errors are logged and swallowed so the shell never
 * crashes because of storage failures.
 */
export function useRetentionSweep(): void {
  const userId = useSessionStore((s) => s.user?.id);
  const chatRetentionDays = useSettingsStore((s) => s.chatRetentionDays);
  const mediaRetentionDays = useSettingsStore((s) => s.mediaRetentionDays);
  const previousSettings = useRef<string | null>(null);

  useEffect(() => {
    if (userId === undefined || userId === null) return;

    const signature = `${chatRetentionDays}/${mediaRetentionDays}`;
    const changed = previousSettings.current !== null && previousSettings.current !== signature;
    previousSettings.current = signature;

    const sweep = async (): Promise<void> => {
      if (sweepInFlight) return;
      sweepInFlight = true;
      try {
        await runRetentionSweep(userId);
      } catch (e) {
        void debugLog("retention.sweep hook", e);
      } finally {
        sweepInFlight = false;
      }
    };

    let firstTimer: ReturnType<typeof setTimeout> | undefined;
    if (changed) {
      void sweep();
    } else {
      firstTimer = setTimeout(() => void sweep(), FIRST_RUN_DELAY_MS);
    }
    const intervalTimer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);

    return () => {
      if (firstTimer !== undefined) clearTimeout(firstTimer);
      clearInterval(intervalTimer);
    };
  }, [userId, chatRetentionDays, mediaRetentionDays]);
}
