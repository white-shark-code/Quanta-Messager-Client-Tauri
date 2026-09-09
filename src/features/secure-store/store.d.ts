/**
 * Per-user encrypted keystore, indexed by a non-encrypted `index.json`.
 *
 * Disk layout under `<app_data_dir>`:
 *
 *     keystores/
 *       index.json          — unencrypted metadata: which userIds have a
 *                             keystore on this device
 *       <userId>.qks        — ChaCha20-Poly1305 ciphertext for one user
 *
 * The container format (`format.ts`) is unchanged: magic "QKS1",
 * kdf_salt, chacha_nonce, ciphertext+tag. Only the FILE PATH now
 * carries the userId so multiple users can coexist on the same device.
 *
 * Index rules:
 *   - `upsertIndexEntry` is called on every successful login.
 *   - `removeIndexEntry` is called when a user's keystore is explicitly
 *     erased (e.g. logout with "erase all data" checkbox).
 *   - The index is plain JSON (not encrypted) — it only contains
 *     metadata, no secrets.
 */
import type { KeystorePayload, KeystoreIndex, KeystoreIndexEntry } from "./types";
export declare const KEYSTORE_DIR = "keystores";
export declare const KEYSTORE_INDEX_PATH = "keystores/index.json";
/**
 * Return the absolute (relative to app_data_dir) file path for a
 * user's encrypted keystore. Single source of truth so call sites
 * never disagree on the layout.
 */
export declare function getKeystorePath(userId: string): string;
/**
 * Read the keystore index. Returns an empty index when the file
 * doesn't exist yet (first run, no users registered on this device).
 *
 * The file is plain JSON, so no passphrase is involved.
 */
export declare function readIndex(): Promise<KeystoreIndex>;
/**
 * Overwrite the keystore index with the given value.
 */
export declare function writeIndex(idx: KeystoreIndex): Promise<void>;
/**
 * Insert or update the entry for `entry.userId`. Preserves the order
 * of existing users (new users are appended at the end).
 */
export declare function upsertIndexEntry(entry: KeystoreIndexEntry): Promise<void>;
/**
 * Remove the entry for `userId`. No-op if not present.
 */
export declare function removeIndexEntry(userId: string): Promise<void>;
export declare function writeKeystore(userId: string, payload: KeystorePayload, passphrase: string): Promise<void>;
export declare function readKeystore(userId: string, passphrase: string): Promise<KeystorePayload>;
/**
 * Re-encrypt the keystore with a fresh access token (e.g. after
 * /auth/login re-authorization) without disturbing any other field.
 *
 * Re-uses `readKeystore` to decrypt with the existing passphrase,
 * swaps the `accessToken` field, then `writeKeystore` re-encrypts
 * with a freshly generated salt and ChaCha20 nonce.
 *
 * @throws Re-throws whatever `readKeystore` throws (wrong passphrase /
 *         corrupt file). Callers must surface those as user-facing errors.
 */
export declare function updateKeystoreToken(userId: string, passphrase: string, newAccessToken: string): Promise<KeystorePayload>;
/**
 * Erase the encrypted keystore file for `userId` from disk. The
 * corresponding index entry should be removed separately by the caller
 * (see `deleteKeystoreForUser` in `keyring/generate.ts` which bundles
 * the two operations).
 */
export declare function deleteKeystore(userId: string): Promise<void>;
