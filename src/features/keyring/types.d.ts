/**
 * Public types for the PGP keyring service.
 *
 * Mirrors the API exposed by `src/features/keyring/encrypt.ts` so callers
 * (Zustand store, React components, secure-store glue) can depend on
 * stable shapes without importing openpgp.js directly.
 */
/**
 * Result of generating a new PGP key pair.
 *
 * `privateKeyArmored` is protected with the user-supplied passphrase
 * (AEAD + S2K, see openpgp v6 docs for `generateKey`). Both blobs are
 * ASCII-armored so they can be safely stored as UTF-8 strings.
 *
 * `fingerprint` is the uppercase hex SHA-1 fingerprint of the primary
 * public key (40 hex chars for v4 keys, 64 for v6 keys).
 */
export interface KeyPair {
    privateKeyArmored: string;
    publicKeyArmored: string;
    fingerprint: string;
}
/**
 * Output of an encrypt+sign operation.
 *
 * Both fields are raw `Uint8Array` so the caller can serialize them
 * however it wants (base64 for JSON transport, raw bytes for binary APIs).
 *
 * - `encrypted`: the OpenPGP message — encrypted to every recipient and
 *   with the sender's signature embedded inside the message.
 * - `signature`: a *detached* signature over the same payload, so the
 *   server can verify authorship without parsing the encrypted blob.
 */
export interface EncryptResult {
    encrypted: Uint8Array;
    signature: Uint8Array;
}
/**
 * Algorithm family used by `generateKeyPair`.
 *
 * - `"ecc"`: Curve25519Legacy (default) — fast, small, RFC 9580 recommended.
 * - `"rsa"`: 4096-bit RSA — for compatibility with legacy clients.
 */
export type KeyAlgorithm = "ecc" | "rsa";
