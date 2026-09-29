export interface PublicKeyResponse {
    user_id: string;
    has_public_key: boolean;
    /**
     * ASCII-armored PGP public key text, ready for
     * `keyring.importPublicKey`. `null` when `has_public_key` is false.
     * `getUserPublicKey` decodes the base64 wire form — callers must
     * NOT decode again.
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
export declare function getUserPublicKey(userId: string): Promise<PublicKeyResponse>;
