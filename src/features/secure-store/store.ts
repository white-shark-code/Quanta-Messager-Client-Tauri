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

import {
  hasKeystore,
  readKeystoreBuffer,
  writeKeystoreBuffer,
  readIndexBuffer,
  writeIndexBuffer,
  deleteKeystoreFile,
} from "@/infra/tauriBridge";

import { decrypt } from "./cipher";
import { DEFAULT_KDF_PARAMS, deriveKey, generateSalt } from "./kdf";
import { parse, serialize } from "./format";
import type { KeystorePayload, KeystoreIndex, KeystoreIndexEntry } from "./types";

export const KEYSTORE_DIR = "keystores";
export const KEYSTORE_INDEX_PATH = "keystores/index.json";

/**
 * Return the absolute (relative to app_data_dir) file path for a
 * user's encrypted keystore. Single source of truth so call sites
 * never disagree on the layout.
 */
export function getKeystorePath(userId: string): string {
  return `${KEYSTORE_DIR}/${userId}.qks`;
}

/* ------------------------------------------------------------------ *
 * Index helpers (unencrypted metadata)
 * ------------------------------------------------------------------ */

/**
 * Read the keystore index. Returns an empty index when the file
 * doesn't exist yet (first run, no users registered on this device).
 *
 * The file is plain JSON, so no passphrase is involved.
 */
export async function readIndex(): Promise<KeystoreIndex> {
  try {
    const buf = await readIndexBuffer();
    if (buf.byteLength === 0) {
      return { users: [] };
    }
    const text = new TextDecoder().decode(buf);
    const parsed = JSON.parse(text) as KeystoreIndex;
    if (!Array.isArray(parsed.users)) {
      return { users: [] };
    }
    return parsed;
  } catch {
    // Missing file or unreadable — treat as empty.
    return { users: [] };
  }
}

/**
 * Overwrite the keystore index with the given value.
 */
export async function writeIndex(idx: KeystoreIndex): Promise<void> {
  const json = JSON.stringify(idx, null, 2);
  await writeIndexBuffer(new TextEncoder().encode(json));
}

/**
 * Insert or update the entry for `entry.userId`. Preserves the order
 * of existing users (new users are appended at the end).
 */
export async function upsertIndexEntry(entry: KeystoreIndexEntry): Promise<void> {
  const idx = await readIndex();
  const existing = idx.users.findIndex((u) => u.userId === entry.userId);
  if (existing >= 0) {
    idx.users[existing] = entry;
  } else {
    idx.users.push(entry);
  }
  await writeIndex(idx);
}

/**
 * Remove the entry for `userId`. No-op if not present.
 */
export async function removeIndexEntry(userId: string): Promise<void> {
  const idx = await readIndex();
  idx.users = idx.users.filter((u) => u.userId !== userId);
  await writeIndex(idx);
}

/**
 * Resolve the most recently used user that still has a keystore on disk.
 *
 * Reads the unencrypted index (`readIndex()`), sorts entries by
 * `lastUsedAt` descending (entries with unparsable dates are ignored),
 * then returns the first `userId` for which `hasKeystore(userId)` is
 * true.
 *
 * Best-effort: any error (index unreadable, `hasKeystore` throwing,
 * etc.) results in `null` rather than a rejection, so boot-redirect
 * callers can fall back to `/login` without extra try/catch.
 */
export async function getLastUserId(): Promise<string | null> {
  try {
    const idx = await readIndex();
    const users = idx.users;
    if (!Array.isArray(users) || users.length === 0) {
      return null;
    }
    const ranked: { userId: string; time: number }[] = [];
    for (const entry of users) {
      if (
        entry === null ||
        typeof entry !== "object" ||
        typeof entry.userId !== "string" ||
        entry.userId.length === 0 ||
        typeof entry.lastUsedAt !== "string"
      ) {
        continue;
      }
      const time = Date.parse(entry.lastUsedAt);
      if (Number.isNaN(time)) {
        continue;
      }
      ranked.push({ userId: entry.userId, time });
    }
    if (ranked.length === 0) {
      return null;
    }
    ranked.sort((a, b) => b.time - a.time);
    for (const candidate of ranked) {
      try {
        if (await hasKeystore(candidate.userId)) {
          return candidate.userId;
        }
      } catch {
        // hasKeystore failed for this candidate — try the next one.
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Per-user encrypted keystore
 * ------------------------------------------------------------------ */

export async function writeKeystore(
  userId: string,
  payload: KeystorePayload,
  passphrase: string,
): Promise<void> {
  const kdfSalt = generateSalt();
  const key = await deriveKey(passphrase, {
    ...DEFAULT_KDF_PARAMS,
    salt: kdfSalt,
  });
  const buf = await serialize(payload, key, kdfSalt);
  await writeKeystoreBuffer(userId, buf);
}

export async function readKeystore(userId: string, passphrase: string): Promise<KeystorePayload> {
  const buf = await readKeystoreBuffer(userId);
  const { kdfSalt, chachaNonce, ciphertext } = parse(buf);
  const key = await deriveKey(passphrase, {
    ...DEFAULT_KDF_PARAMS,
    salt: kdfSalt,
  });
  const plaintext = decrypt(ciphertext, key, chachaNonce);
  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as KeystorePayload;
  if (payload.version !== 1) {
    throw new Error(`Unsupported plaintext version: ${payload.version}`);
  }
  return payload;
}

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
export async function updateKeystoreToken(
  userId: string,
  passphrase: string,
  newAccessToken: string,
): Promise<KeystorePayload> {
  const current = await readKeystore(userId, passphrase);
  const updated: KeystorePayload = {
    ...current,
    accessToken: newAccessToken,
  };
  await writeKeystore(userId, updated, passphrase);
  return updated;
}

/**
 * Erase the encrypted keystore file for `userId` from disk. The
 * corresponding index entry should be removed separately by the caller
 * (see `deleteKeystoreForUser` in `keyring/generate.ts` which bundles
 * the two operations).
 */
export async function deleteKeystore(userId: string): Promise<void> {
  await deleteKeystoreFile(userId);
}
