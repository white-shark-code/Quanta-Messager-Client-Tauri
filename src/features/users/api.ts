/**
 * Lookup endpoints for arbitrary users — needed for fetching a peer's
 * public PGP key before opening a chat with them.
 *
 * Endpoints consumed here:
 *   GET /users/{user_id}/public-key  →  PublicKeyResponse
 */
import { apiClient } from "@/infra/apiClient";
import { decodeWireText } from "@/lib/wire";

/**
 * Raw wire shape.
 *
 * Contract: FastAPI's `jsonable_encoder` base64-encodes the `bytes`
 * column, so `public_key` arrives as base64 of the ASCII-armored key
 * text. Reality: some deployments serve raw armor text instead
 * (DB column drift — observed live: armor with newlines, 200 OK,
 * `has_public_key: true`). Decoding is tolerant to both shapes
 * (see `decodeWireText`).
 */
interface PublicKeyWireResponse {
  user_id: string;
  has_public_key: boolean;
  public_key: string | null;
}

export interface PublicKeyResponse {
  user_id: string;
  has_public_key: boolean;
  /**
   * ASCII-armored PGP public key text, ready for
   * `keyring.importPublicKey`. `null` when `has_public_key` is false.
   * `getUserPublicKey` tolerantly decodes the wire form (base64 or
   * raw armor) — callers must NOT decode again.
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
export async function getUserPublicKey(userId: string): Promise<PublicKeyResponse> {
  const wire = await apiClient.get<PublicKeyWireResponse>(`/users/${userId}/public-key`);
  return {
    user_id: wire.user_id,
    has_public_key: wire.has_public_key,
    public_key:
      wire.has_public_key && wire.public_key !== null ? decodeWireText(wire.public_key) : null,
  };
}
