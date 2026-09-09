/**
 * Lookup endpoints for arbitrary users — needed for fetching a peer's
 * public PGP key before opening a chat with them.
 *
 * Endpoints consumed here:
 *   GET /users/{user_id}/public-key  →  PublicKeyResponse
 */
import { apiClient } from "@/infra/apiClient";

export interface PublicKeyResponse {
  user_id: string;
  has_public_key: boolean;
  /**
   * Base64-encoded PGP public key bytes on the wire (FastAPI's
   * `jsonable_encoder` base64-encodes raw `bytes` fields). `null`
   * when `has_public_key` is false. Decoding back to `Uint8Array`
   * is the caller's job (use `Uint8Array.from(atob(b64), c => ...)`).
   */
  public_key: string | null;
}

/**
 * Fetch the PGP public key of a single user by their UUID.
 *
 * Returns a structured `has_public_key` flag so the UI can
 * distinguish "user doesn't exist" (404, propagated as an error)
 * from "user exists but hasn't uploaded a key" (200, `has_public_key: false`).
 */
export function getUserPublicKey(userId: string): Promise<PublicKeyResponse> {
  return apiClient.get<PublicKeyResponse>(`/users/${userId}/public-key`);
}
