/**
 * Lookup endpoints for arbitrary users — needed for fetching a peer's
 * public PGP key before opening a chat with them.
 *
 * Endpoints consumed here:
 *   GET /users/{user_id}/public-key  →  PublicKeyResponse
 */
import { apiClient } from "@/infra/apiClient";
/**
 * Fetch the PGP public key of a single user by their UUID.
 *
 * Returns a structured `has_public_key` flag so the UI can
 * distinguish "user doesn't exist" (404, propagated as an error)
 * from "user exists but hasn't uploaded a key" (200, `has_public_key: false`).
 */
export function getUserPublicKey(userId) {
    return apiClient.get(`/users/${userId}/public-key`);
}
