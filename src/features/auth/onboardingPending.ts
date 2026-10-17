/**
 * Silent "onboarding unfinished" flag (Task 1 — server → disk order).
 *
 * Lifecycle:
 *   - `markOnboardingPending` — set BEFORE Phase A (in-memory key
 *     generation), while the user + email are known.
 *   - `clearOnboardingPending` — after Phase B (keystore written to
 *     disk) succeeds, or when the user takes the valid "skip" path
 *     (`createBareKeystore` — entering without a key is a feature).
 *
 * If the network drops during `changePublicKey`, no `.qks` file exists
 * on disk but this flag does — the next login routes back to key
 * generation (`/create-keystore?resume=1`) instead of `/chats`.
 * Deliberately silent: no `beforeunload` dialog (product decision 1.2).
 *
 * Storage: plain `localStorage` (unencrypted metadata — userId + email
 * + timestamp only, no secrets), mirroring the keystore-index approach.
 */

import { hasKeystore } from "@/infra/tauriBridge";

import { me } from "./api";

export const ONBOARDING_PENDING_KEY = "quant-onboarding-pending";

export interface OnboardingPending {
  userId: string;
  email: string;
  /** ISO-8601 timestamp of when Phase A started. */
  startedAt: string;
}

function readStorage(): OnboardingPending | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(ONBOARDING_PENDING_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as OnboardingPending).userId !== "string" ||
      (parsed as OnboardingPending).userId.length === 0 ||
      typeof (parsed as OnboardingPending).email !== "string" ||
      typeof (parsed as OnboardingPending).startedAt !== "string"
    ) {
      return null;
    }
    return parsed as OnboardingPending;
  } catch {
    // Corrupt JSON or storage unavailable — treat as "no flag".
    return null;
  }
}

/** Current pending onboarding, or `null` when onboarding completed/skipped. */
export function getOnboardingPending(): OnboardingPending | null {
  return readStorage();
}

/** True when an unfinished onboarding is recorded for exactly `userId`. */
export function isOnboardingPendingFor(userId: string): boolean {
  return readStorage()?.userId === userId;
}

/** Record the start of Phase A. Never throws (storage is best-effort). */
export function markOnboardingPending(userId: string, email: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    const value: OnboardingPending = {
      userId,
      email,
      startedAt: new Date().toISOString(),
    };
    localStorage.setItem(ONBOARDING_PENDING_KEY, JSON.stringify(value));
  } catch {
    // Storage full/blocked — onboarding still works, resume just won't trigger.
  }
}

/** Clear after Phase B success or skip-mode. Never throws. */
export function clearOnboardingPending(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(ONBOARDING_PENDING_KEY);
  } catch {
    // ignored — best-effort
  }
}

/**
 * Should `userId` resume key generation instead of entering chats?
 *
 * True iff the pending flag names this user AND no keystore file exists
 * on disk. (A bare `NO_KEY` keystore counts as existing here — that case
 * is detected post-unlock via the decrypted `fingerprint`, which we
 * cannot read without the passphrase, see `UnlockRoute`.)
 */
export async function shouldResumeOnboarding(userId: string): Promise<boolean> {
  if (!isOnboardingPendingFor(userId)) return false;
  try {
    return !(await hasKeystore(userId));
  } catch {
    return false;
  }
}

/**
 * Best-effort reconciliation of "did the server already accept a key?"
 * using the existing `me()` endpoint (no new server handles).
 *
 * Returns `true` when the profile carries a public key, `false` when it
 * provably has none, `null` when unknown (older backend shape without
 * key fields, or the request failed). Either way the caller generates a
 * fresh pair over it — per decision 1.3 a lost local pair is replaced,
 * never recovered — so this is informational only (resume banner /
 * debug log), never a flow gate.
 */
export async function probeServerKeyAccepted(): Promise<boolean | null> {
  try {
    const profile = await me();
    if (profile.has_public_key === true) return true;
    if (typeof profile.public_key === "string" && profile.public_key.length > 0) return true;
    if (profile.has_public_key === false) return false;
    // Backend shape without key fields — cannot tell.
    return null;
  } catch {
    return null;
  }
}
