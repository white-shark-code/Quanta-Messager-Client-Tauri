/**
 * Re-authenticate an already-unlocked session against `/auth/login` and
 * persist the fresh bearer into the encrypted keystore.
 *
 * Used by the "unlock-again" modal when the existing `accessToken` is
 * rejected with 401. The flow is:
 *
 *   1. `unlockWithPassphrase` re-loads the in-memory keys + the (now
 *      rejected) bearer so `apiClient` is at least wired up.
 *   2. `authApi.login` against `/auth/login` with the user's email
 *      (taken from `sessionStore.user.email`) + server password →
 *      fresh `access_token`.
 *   3. `updateKeystoreToken` re-encrypts the keystore with the new token.
 *   4. `configureClient` swaps the token provider so subsequent requests
 *      carry the fresh bearer.
 *   5. `authApi.me()` validates the new token and refreshes session
 *      metadata (in case email/id drifted server-side).
 *
 * The email is sourced from `sessionStore` by default, but callers
 * that already resolved the identity (e.g. `UnlockAgainModal` falling
 * back to the keystore index when the store is empty) may pass it
 * explicitly via `ReauthArgs.email`. Letting the caller type a *free*
 * email would still be an invitation to cross-account token confusion,
 * so the modal only ever passes the email locked to the keystore owner.
 */
import { setAccessToken } from "@/features/auth/accessToken";
import * as authApi from "@/features/auth/api";
import { unlockWithPassphrase } from "@/features/auth/unlock";
import { updateKeystoreToken } from "@/features/secure-store/store";
import { useSessionStore } from "@/features/auth/sessionStore";

export interface ReauthArgs {
  /** The keystore's owning userId — used to scope the re-encrypt. */
  userId: string;
  /** The passphrase that decrypts the ChaCha20 container on disk. */
  keystorePassphrase: string;
  /**
   * Optional passphrase for the PGP private key packet itself. Defaults
   * to `keystorePassphrase` when omitted (typical case).
   */
  pgpPassphrase?: string;
  /** Server password — re-authorized against `/auth/login`. */
  serverPassword: string;
  /**
   * Explicit account email for `/auth/login`.
   *
   * Falls back to `sessionStore.user.email` when omitted (back-compat).
   * The `throw` on missing identity only fires when neither source
   * provides an email, so index-resolved identities keep working.
   */
  email?: string;
}

export async function reauth(args: ReauthArgs): Promise<void> {
  const email = args.email ?? useSessionStore.getState().user?.email;
  if (email === undefined || email.length === 0) {
    throw new Error("reauth: no user in session — cannot determine email");
  }

  // 1. Decrypt keystore + import keys.
  await unlockWithPassphrase(args.userId, args.keystorePassphrase, args.pgpPassphrase);

  // 2. Re-login → fresh access token. fastapi-users uses OAuth2 form
  //    fields `username` / `password` (see auth/api.ts). The username
  //    is the user's email — from the explicit arg when the caller
  //    resolved it via the keystore index, otherwise from the previous
  //    login still sitting in sessionStore.user.email.
  const res = await authApi.login({
    username: email,
    password: args.serverPassword,
  });

  // 3. Persist the new token in the (still-decrypted) keystore.
  await updateKeystoreToken(args.userId, args.keystorePassphrase, res.access_token);

  // 4. Publish the fresh bearer into the shared in-memory holder.
  // apiClient reads it through the single `bindTokenProvider(() =>
  // getAccessToken())` binding (see queries.ts), so a later lock()
  // clearing the holder revokes it — a per-token closure here would
  // keep sending the old bearer after lock (soft-lock retains identity).
  setAccessToken(res.access_token);

  // 5. Validate the new token by hitting /users/me; refresh session
  //    metadata in case the server returned updated fields.
  const refreshed = await authApi.me();
  useSessionStore.getState().setUser({ id: refreshed.id, email: refreshed.email });
}
