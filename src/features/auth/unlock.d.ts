/**
 * Unlock an existing keystore with a passphrase.
 *
 * Two distinct passphrases are involved:
 *   1. **Keystore passphrase** — required. Derives the Argon2id key that
 *      decrypts the ChaCha20-Poly1305 container holding `payload`.
 *   2. **PGP passphrase** — optional. Needed to decrypt the private key
 *      packet itself (passed to `openpgp.decryptKey`). Most users set
 *      the same string for both; the split exists so power users can
 *      rotate them independently.
 *
 * When `pgpPassphrase` is omitted we default to the keystore passphrase
 * — this keeps the simple case ("one passphrase for everything") working
 * with zero UX overhead.
 *
 * Note: we deliberately do NOT call `upsertIndexEntry` here —
 * `lastUsedAt` is refreshed once per session on login, not on every
 * unlock (per product decision).
 */
export declare function unlockWithPassphrase(userId: string, keystorePassphrase: string, pgpPassphrase?: string): Promise<void>;
