/**
 * Single in-memory holder for the backend Bearer access token.
 *
 * The token lives in a module-private variable and is intentionally
 * NEVER persisted (no localStorage / no store plugin) — once the
 * in-memory module is gone the user has to log in again.
 *
 * Writers: `useLogin` (fresh `/auth/login` token) and
 * `unlockWithPassphrase` (token from the decrypted keystore) publish
 * via {@link setAccessToken}. Readers: `apiClient` consumes it through
 * a single `bindTokenProvider(() => getAccessToken())` binding, and
 * `generateAndStoreKey` reads it via {@link getAccessToken} while it is
 * still hot after login.
 *
 * Lifecycle: `sessionStore.lock()` / `onUnauthorized()` clear it via
 * {@link clearAccessToken}, so a locked session can never keep sending
 * the old Bearer.
 *
 * Future WS contract: `useEventsSocket` must treat the socket as tied
 * to the session — subscribe to `useSessionStore` (`onLocked()` or the
 * `isUnlocked` flag) and close/reconnect the socket on lock/unlock.
 * This module stays dependency-free on purpose so `sessionStore` can
 * import it without creating an import cycle.
 */

let accessToken: string | null = null;

/** Publish a new token (login / unlock / re-auth). Pass `null` to revoke. */
export function setAccessToken(t: string | null): void {
  accessToken = t;
}

/** Read the current token, if any. */
export function getAccessToken(): string | null {
  return accessToken;
}

/** Revoke the token (lock / logout / 401). Never throws. */
export function clearAccessToken(): void {
  accessToken = null;
}
