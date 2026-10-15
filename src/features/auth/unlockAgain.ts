/**
 * Shared decision logic for the "unlock-again" modal (T3 unlock-first).
 *
 * The modal must NOT require the server password up-front: the common
 * case is a soft lock where the keystore bearer is still valid, so a
 * quiet plain unlock (`unlockWithPassphrase` + probe `authApi.me()`) is
 * attempted first. Only when the probe is rejected with 401 does the
 * modal reveal the server-password section (`needsReauth`) and route
 * the next submit through `reauth()` (unlock + `/auth/login`).
 *
 * This module holds the parts of that flow that don't need React so
 * they can be unit-tested in a node environment (no @testing-library
 * in this repo): identity resolution from the keystore index, 401
 * detection, and the submit path selection.
 */
import * as authApi from "@/features/auth/api";
import type { ReauthArgs } from "@/features/auth/reauth";
import { reauth } from "@/features/auth/reauth";
import { unlockWithPassphrase } from "@/features/auth/unlock";
import type { KeystoreIndexEntry } from "@/features/secure-store/types";
import { ApiError } from "@/infra/error";

export interface UnlockAgainIdentity {
  userId: string;
  email: string;
}

/**
 * Resolve the modal identity from the unencrypted keystore index.
 *
 * `preferredUserId` is normally the result of `getLastUserId()` (most
 * recently used user whose keystore file still exists on disk). When it
 * matches an index entry we use that entry's email; otherwise — e.g.
 * the index changed under us — we fall back to the entry with the
 * freshest parseable `lastUsedAt` so a non-empty index still yields an
 * identity instead of a dead-end "no user" error.
 *
 * Returns `null` only when the index has no usable entry at all; the
 * modal then shows a "log in again" hint instead of throwing.
 */
export function resolveIndexIdentity(
  users: KeystoreIndexEntry[],
  preferredUserId: string | null,
): UnlockAgainIdentity | null {
  if (preferredUserId !== null && preferredUserId.length > 0) {
    const direct = users.find((u) => u.userId === preferredUserId);
    if (direct !== undefined && direct.email.length > 0) {
      return { userId: direct.userId, email: direct.email };
    }
  }
  let best: UnlockAgainIdentity | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const entry of users) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.userId !== "string" ||
      entry.userId.length === 0 ||
      typeof entry.email !== "string" ||
      entry.email.length === 0 ||
      typeof entry.lastUsedAt !== "string"
    ) {
      continue;
    }
    const time = Date.parse(entry.lastUsedAt);
    if (Number.isNaN(time) || time <= bestTime) {
      continue;
    }
    bestTime = time;
    best = { userId: entry.userId, email: entry.email };
  }
  return best;
}

/**
 * True when `err` is an HTTP 401 rejection.
 *
 * Accepts both `ApiError` (real `apiClient` path) and duck-typed
 * `{ status: 401 }` objects so mocked transports in tests don't need
 * the full error class.
 */
export function isUnauthorizedError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 401;
  }
  if (typeof err === "object" && err !== null && "status" in err) {
    return (err as { status?: unknown }).status === 401;
  }
  return false;
}

export interface SubmitUnlockAgainDeps {
  unlockWithPassphrase?: (
    userId: string,
    keystorePassphrase: string,
    pgpPassphrase?: string,
  ) => Promise<void>;
  me?: () => Promise<{ id: string; email: string }>;
  reauth?: (args: ReauthArgs) => Promise<void>;
}

export interface SubmitUnlockAgainArgs {
  identity: UnlockAgainIdentity;
  keystorePassphrase: string;
  pgpPassphrase?: string;
  /** Empty string = plain unlock first; non-empty = unlock + reauth. */
  serverPassword: string;
  deps?: SubmitUnlockAgainDeps;
}

export type SubmitUnlockAgainOutcome = { kind: "unlocked" } | { kind: "needsReauth" };

/**
 * Single submit step of the unlock-again modal.
 *
 * - `serverPassword` non-empty → `reauth()` (unlock + `/auth/login`
 *   with the locked identity email) → `{ kind: "unlocked" }`.
 * - `serverPassword` empty → quiet plain unlock, then probe
 *   `authApi.me()`: success → `{ kind: "unlocked" }`; 401 rejection →
 *   `{ kind: "needsReauth" }` (caller must keep the form state and
 *   reveal the server-password section instead of closing).
 *
 * Any other failure rejects and the caller surfaces it in the error
 * alert without dropping the already-typed field values.
 */
export async function submitUnlockAgain(
  args: SubmitUnlockAgainArgs,
): Promise<SubmitUnlockAgainOutcome> {
  const doUnlock = args.deps?.unlockWithPassphrase ?? unlockWithPassphrase;
  const doMe = args.deps?.me ?? authApi.me;
  const doReauth = args.deps?.reauth ?? reauth;

  if (args.serverPassword.length > 0) {
    await doReauth({
      userId: args.identity.userId,
      email: args.identity.email,
      keystorePassphrase: args.keystorePassphrase,
      ...(args.pgpPassphrase !== undefined ? { pgpPassphrase: args.pgpPassphrase } : {}),
      serverPassword: args.serverPassword,
    });
    return { kind: "unlocked" };
  }

  await doUnlock(args.identity.userId, args.keystorePassphrase, args.pgpPassphrase);
  try {
    await doMe();
  } catch (e) {
    if (isUnauthorizedError(e)) {
      return { kind: "needsReauth" };
    }
    throw e;
  }
  return { kind: "unlocked" };
}
