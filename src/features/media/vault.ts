/**
 * Media vault: decrypted attachments at rest under ChaCha20-Poly1305.
 *
 * Each attachment lives in its own file
 * `media/<userId>/<mediaId>.qmed` — the same QDLG1 envelope the
 * dialog-store uses (`secure-store/format`), keyed by the user's
 * `dialogKey`. The payload is the DECRYPTED bytes (verified at write
 * time, so reads skip PGP entirely), plus metadata:
 *
 *   `{ mediaId, mime, size, chatId?, messageId?, plainB64, storedAt }`
 *
 * Design notes:
 * - Write-after-verify: entries are persisted only after a successful
 *   `decryptFile` (or straight from the upload path, where the
 *   plaintext is already in hand). The vault never sees ciphertext.
 * - `index.json` per user tracks
 *   `{ id, size, lastAccess, storedAt?, chatId? }` for LRU eviction under
 *   {@link MEDIA_VAULT_QUOTA_BYTES} and age-based retention.
 * - Reads are vault-first: hit → bytes immediately (offline-capable);
 *   miss/corruption → `undefined` and the caller falls back to network.
 *   Corrupt entries are deleted on sight.
 * - All persistence is best-effort: browser `localStorage` quota
 *   failures surface as throws from the bridge and are swallowed here
 *   (returns void) so media viewing never breaks for storage reasons.
 */

import { useKeyringStore } from "@/features/keyring/keyringStore";
import { decrypt as chachaDecrypt } from "@/features/secure-store/cipher";
import { packDialog, parseDialog, serializeDialog } from "@/features/secure-store/format";
import {
  deleteMediaFile,
  readMediaBuffer,
  readMediaIndex,
  writeMediaBuffer,
  writeMediaIndex,
} from "@/infra/tauriBridge";
import { debugLog } from "@/lib/debug";

import { MEDIA_VAULT_QUOTA_BYTES } from "./constants";

export interface MediaVaultPayload {
  mediaId: string;
  mime: string;
  size: number;
  chatId?: string;
  messageId?: string;
  /** Base64 of the DECRYPTED bytes. */
  plainB64: string;
  storedAt: number;
}

export interface MediaVaultEntry {
  id: string;
  size: number;
  lastAccess: number;
  /**
   * Epoch ms of the last write. Age anchor for retention cleanup; absent
   * on entries written by older versions (fall back to `lastAccess`).
   */
  storedAt?: number;
  chatId?: string;
}

export interface MediaVaultHit {
  bytes: Uint8Array;
  mime: string;
}

const B64_CHUNK = 0x8000;

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function getKey(): Uint8Array {
  const dialogKeyB64 = useKeyringStore.getState().dialogKeyB64;
  if (dialogKeyB64 === null || dialogKeyB64.length === 0) {
    throw new Error("media-vault: no dialogKey in memory — keystore not unlocked");
  }
  return b64ToBytes(dialogKeyB64);
}

function parseIndex(raw: string): MediaVaultEntry[] {
  if (raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is MediaVaultEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as { id?: unknown }).id === "string" &&
        typeof (e as { size?: unknown }).size === "number",
    );
  } catch {
    return [];
  }
}

async function loadIndex(userId: string): Promise<MediaVaultEntry[]> {
  return parseIndex(await readMediaIndex(userId));
}

async function saveIndex(userId: string, entries: MediaVaultEntry[]): Promise<void> {
  await writeMediaIndex(userId, JSON.stringify(entries));
}

/**
 * Read a vault entry. Returns `undefined` on miss, corruption
 * (corrupt file is deleted), or locked keystore. Updates `lastAccess`
 * best-effort for LRU accounting.
 */
export async function readMediaVault(
  userId: string,
  mediaId: string,
): Promise<MediaVaultHit | undefined> {
  let key: Uint8Array;
  try {
    key = getKey();
  } catch {
    return undefined;
  }
  let buf: Uint8Array;
  try {
    buf = await readMediaBuffer(userId, mediaId);
  } catch {
    return undefined;
  }
  let payload: MediaVaultPayload;
  try {
    const { chachaNonce, ciphertext } = parseDialog(buf);
    const json = new TextDecoder().decode(chachaDecrypt(ciphertext, key, chachaNonce));
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { plainB64?: unknown }).plainB64 !== "string" ||
      typeof (parsed as { mime?: unknown }).mime !== "string"
    ) {
      throw new Error("bad payload shape");
    }
    payload = parsed as MediaVaultPayload;
  } catch {
    void deleteMediaFile(userId, mediaId).catch(() => undefined);
    return undefined;
  }
  void (async () => {
    try {
      const entries = await loadIndex(userId);
      const entry = entries.find((e) => e.id === mediaId);
      if (entry !== undefined) {
        entry.lastAccess = Date.now();
        await saveIndex(userId, entries);
      }
    } catch {
      // LRU bookkeeping must never break reads
    }
  })();
  return { bytes: b64ToBytes(payload.plainB64), mime: payload.mime };
}

export interface WriteMediaVaultInput {
  mediaId: string;
  plain: Uint8Array;
  mime: string;
  chatId?: string;
  messageId?: string;
  /** Override for tests — production always uses the module quota. */
  quotaBytes?: number;
}

/**
 * Persist decrypted bytes. Evicts least-recently-used entries when the
 * write would exceed quota. Never throws (storage is best-effort) —
 * returns `false` when nothing was persisted.
 */
export async function writeMediaVault(
  userId: string,
  input: WriteMediaVaultInput,
): Promise<boolean> {
  let key: Uint8Array;
  try {
    key = getKey();
  } catch {
    return false;
  }
  const quota = input.quotaBytes ?? MEDIA_VAULT_QUOTA_BYTES;
  try {
    const payload: MediaVaultPayload = {
      mediaId: input.mediaId,
      mime: input.mime,
      size: input.plain.length,
      plainB64: bytesToB64(input.plain),
      storedAt: Date.now(),
      ...(input.chatId !== undefined ? { chatId: input.chatId } : {}),
      ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
    };
    const packed = packDialog(serializeDialog(payload, key));
    await writeMediaBuffer(userId, input.mediaId, packed);
    const entries = await loadIndex(userId);
    const without = entries.filter((e) => e.id !== input.mediaId);
    const now = Date.now();
    without.push({
      id: input.mediaId,
      size: input.plain.length,
      lastAccess: now,
      storedAt: now,
      ...(input.chatId !== undefined ? { chatId: input.chatId } : {}),
    });
    // LRU eviction, oldest access first (the just-written entry is
    // newest, so it always survives its own write).
    let total = without.reduce((sum, e) => sum + e.size, 0);
    without.sort((a, b) => a.lastAccess - b.lastAccess);
    while (total > quota && without.length > 1) {
      const victim = without.shift();
      if (victim === undefined) break;
      total -= victim.size;
      await deleteMediaFile(userId, victim.id);
    }
    await saveIndex(userId, without);
    return true;
  } catch (e) {
    void debugLog("media-vault write", e, { mediaId: input.mediaId });
    return false;
  }
}

/**
 * Delete all vault entries linked to a chat (entries written without
 * `chatId` survive — full wipe via {@link clearMediaVault} instead).
 * Returns the number of deleted entries. Never throws.
 */
export async function deleteMediaForChat(userId: string, chatId: string): Promise<number> {
  try {
    const entries = await loadIndex(userId);
    const victims = entries.filter((e) => e.chatId === chatId);
    const keep = entries.filter((e) => e.chatId !== chatId);
    await Promise.all(victims.map((e) => deleteMediaFile(userId, e.id)));
    await saveIndex(userId, keep);
    return victims.length;
  } catch {
    return 0;
  }
}

/**
 * Retention sweep: delete vault entries older than `retentionDays`.
 *
 * The age anchor is `storedAt` (write time) with a fallback to
 * `lastAccess` for entries written by older versions; entries that have
 * neither timestamp are kept. `retentionDays <= 0` (or a non-finite
 * value) disables the sweep. Victims are removed from disk and dropped
 * from the index; returns the number of deleted entries. Best-effort —
 * an unreadable index yields `0` and the function never throws.
 */
export async function applyMediaRetention(userId: string, retentionDays: number): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  try {
    const entries = await loadIndex(userId);
    const victims = entries.filter((entry) => {
      const anchor = entry.storedAt ?? entry.lastAccess;
      if (typeof anchor !== "number" || !Number.isFinite(anchor)) return false;
      return anchor < cutoff;
    });
    if (victims.length === 0) return 0;
    const victimIds = new Set(victims.map((e) => e.id));
    await Promise.all(victims.map((e) => deleteMediaFile(userId, e.id)));
    await saveIndex(
      userId,
      entries.filter((e) => !victimIds.has(e.id)),
    );
    return victims.length;
  } catch {
    // best-effort — a storage failure must not break the sweep
    return 0;
  }
}

/**
 * Wipe the whole vault (explicit "erase all data"). Best-effort: deletes
 * every indexed entry file and resets the index. Returns the number of
 * deleted entries; `0` when the index is unreadable (nothing is touched).
 * Never throws.
 */
export async function clearMediaVault(userId: string): Promise<number> {
  try {
    const entries = await loadIndex(userId);
    await Promise.all(entries.map((e) => deleteMediaFile(userId, e.id)));
    await saveIndex(userId, []);
    return entries.length;
  } catch {
    // best-effort
    return 0;
  }
}
