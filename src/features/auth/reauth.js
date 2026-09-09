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
 * The email is sourced from `sessionStore` rather than taken as an
 * argument: in a multi-user environment the keystore belongs to one
 * specific userId and the email must match what's inside the keystore.
 * Letting the caller type a different email would be an invitation to
 * cross-account token confusion.
 */
import { configureClient } from "@/infra/apiClient";
import * as authApi from "@/features/auth/api";
import { unlockWithPassphrase } from "@/features/auth/unlock";
import { updateKeystoreToken } from "@/features/secure-store/store";
import { useSessionStore } from "@/features/auth/sessionStore";
export async function reauth(args) {
    const me = useSessionStore.getState().user;
    if (me === null) {
        throw new Error("reauth: no user in session — cannot determine email");
    }
    // 1. Decrypt keystore + import keys.
    await unlockWithPassphrase(args.userId, args.keystorePassphrase, args.pgpPassphrase);
    // 2. Re-login → fresh access token. fastapi-users uses OAuth2 form
    //    fields `username` / `password` (see auth/api.ts). The username
    //    is the user's email — it's already in sessionStore.user.email
    //    from the previous login.
    const res = await authApi.login({
        username: me.email,
        password: args.serverPassword,
    });
    // 3. Persist the new token in the (still-decrypted) keystore.
    await updateKeystoreToken(args.userId, args.keystorePassphrase, res.access_token);
    // 4. Re-point the apiClient at the fresh bearer.
    configureClient({
        tokenProvider: () => res.access_token,
        onUnauthorized: () => useSessionStore.getState().lock(),
    });
    // 5. Validate the new token by hitting /users/me; refresh session
    //    metadata in case the server returned updated fields.
    const refreshed = await authApi.me();
    useSessionStore.getState().setUser({ id: refreshed.id, email: refreshed.email });
}
