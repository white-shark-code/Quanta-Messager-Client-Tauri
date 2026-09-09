import { apiClient } from "@/infra/apiClient";
/**
 * Login with OAuth2 password form-encoded body.
 *
 * fastapi-users' default `/auth/login` endpoint uses
 * `OAuth2PasswordRequestForm` which expects form-encoded
 * (`application/x-www-form-urlencoded`) fields, not JSON.
 * See: fastapi_users.router.auth.get_auth_router + BearerTransport.
 */
export function login(req) {
    const form = new URLSearchParams();
    form.append("username", req.username);
    form.append("password", req.password);
    return apiClient.postForm("/auth/login", form);
}
export function register(req) {
    return apiClient.post("/auth/register", req);
}
export function me() {
    return apiClient.get("/users/me");
}
/**
 * Upload the user's PGP public key after key generation.
 *
 * The backend expects the key as a `text/plain` file inside a multipart
 * form (per `docs/design.md` §5.3 — multipart only for this endpoint).
 * We wrap the armored string in a `Blob` so the wire format is a real
 * file upload rather than a plain text field, which is what FastAPI's
 * `UploadFile` parameter binds to on the server side.
 */
export async function changePublicKey(publicKeyArmored) {
    const form = new FormData();
    form.append("new_public_key", new Blob([publicKeyArmored], { type: "text/plain" }), "public_key.asc");
    return apiClient.postMultipart("/auth/change-public-key", form);
}
export async function logout() {
    try {
        await apiClient.post("/auth/logout");
    }
    catch {
        // best-effort: server-side logout endpoint may not be implemented yet
    }
}
