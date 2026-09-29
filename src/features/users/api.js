/**
 * Lookup endpoints for arbitrary users — needed for fetching a peer's
 * public PGP key before opening a chat with them.
 *
 * Endpoints consumed here:
 *   GET /users/{user_id}/public-key  →  PublicKeyResponse
 */
import { apiClient } from "@/infra/apiClient";
/** base64 → UTF-8 string (armored key text). */
function b64ToText(b64) {
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}
/**
 * Fetch the PGP public key of a single user by their UUID.
 *
 * Returns a structured `has_public_key` flag so the UI can
 * distinguish "user doesn't exist" (404, propagated as an error)
 * from "user exists but hasn't uploaded a key" (200, `has_public_key: false`).
 */
export async function getUserPublicKey(userId) {
    const wire = await apiClient.get(`/users/${userId}/public-key`);
    return {
        user_id: wire.user_id,
        has_public_key: wire.has_public_key,
        public_key: wire.has_public_key && wire.public_key !== null
            ? b64ToText(wire.public_key)
            : null,
    };
}
