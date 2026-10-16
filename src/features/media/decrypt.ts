/**
 * Decrypt + cache pipeline for media attachments (TASK-072).
 *
 * Wraps `mediaApi.downloadPrivateMedia` / `mediaApi.downloadGroupMedia`
 * with:
 *   1. base64 → bytes decoding of the wire payload,
 *   2. `keyring.decryptFile` for PGP decryption + signature verification,
 *   3. Blob creation + `URL.createObjectURL` for `<img>` / `<a>` consumption,
 *   4. an in-memory `Map` cache so repeated previews / reopens don't
 *      re-download or re-decrypt.
 *
 * Design constraints (see `docs/design.md` §5.1.3, §8):
 *   - **Lazy:** nothing is downloaded or decrypted until the caller
 *     actually requests it (typically when a preview enters the viewport
 *     in TASK-073).
 *   - **No UI coupling:** pure async functions returning `{ blob, url, mime }`.
 *     The component layer (TASK-073) is responsible for wiring revoke on
 *     unmount.
 *   - **Vault persistence:** verified plaintext is additionally persisted
 *     to the media vault (`./vault.ts`, ChaCha at rest) write-after-verify,
 *     and reads are vault-first (offline-capable). The in-memory `Map`
 *     stays as the session-speed layer; `clearBlobCache()` wipes RAM on
 *     lock / logout while vault files survive for the next unlock.
 *   - **MVP sender trust:** the spec calls out using the local public key
 *     as the "sender" key for self-originated media. Cross-user verification
 *     (resolving the real sender's key from the roster) is deferred to a
 *     later task.
 *
 * Out of scope: chunked / range download (deferred), LRU eviction (cache is
 * bounded only by the active session), sender-key resolution from the roster.
 */

import * as keyring from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { useSessionStore } from "@/features/auth/sessionStore";
import { decodeWireBytes } from "@/lib/wire";

import * as mediaApi from "./api";
import { readMediaVault, writeMediaVault } from "./vault";

/**
 * Optional linkage for the media vault (decrypted bytes at rest).
 * The vault key is the media id; chat/message linkage enables
 * per-chat purge. Omit entirely to skip the vault (network only).
 */
export interface MediaVaultContext {
  chatId?: string;
  messageId?: string;
}

function vaultUserId(): string | undefined {
  return useSessionStore.getState().user?.id;
}

/**
 * One cached media item.
 *
 * `url` is a `blob:` URL minted by `URL.createObjectURL`. The caller MUST
 * eventually invoke `revokeBlobUrl(id)` (or `clearBlobCache()`) — the
 * browser keeps the underlying `Blob` alive as long as the URL is registered.
 */
export interface CachedMedia {
  blob: Blob;
  url: string;
  mime: string;
}

/**
 * Process-wide cache. Module-scope so multiple components viewing the same
 * `mediaId` share a single decryption result.
 */
const blobCache = new Map<string, CachedMedia>();

/**
 * Drop every cached blob and revoke every URL.
 *
 * Intended for `lock()` / `logout` / "clear all" UI actions — leaving stale
 * `blob:` URLs registered would pin the underlying `Uint8Array`s in memory
 * after the keyring has been wiped.
 */
export function clearBlobCache(): void {
  for (const entry of blobCache.values()) {
    URL.revokeObjectURL(entry.url);
  }
  blobCache.clear();
}

/**
 * Read-only lookup. Returns `undefined` if the media hasn't been decrypted
 * (and therefore not cached) yet.
 */
export function getCachedMedia(mediaId: string): CachedMedia | undefined {
  return blobCache.get(mediaId);
}

/**
 * Revoke and forget a single cached entry.
 *
 * Safe to call on a missing id — it's a no-op then. Safe to call while a
 * component is still rendering the URL: the browser delays actual release
 * until the image/anchor no longer references it.
 */
export function revokeBlobUrl(mediaId: string): void {
  const entry = blobCache.get(mediaId);
  if (entry === undefined) {
    return;
  }
  URL.revokeObjectURL(entry.url);
  blobCache.delete(mediaId);
}

/**
 * Download + decrypt a private-chat media attachment.
 *
 * @throws Error("Keys not loaded") if the keyring is in any state other
 *         than `"ready"` with a populated `privateKey` and `publicKey`.
 *         Components are expected to surface this as a "unlock first" hint.
 * @throws Whatever `mediaApi.downloadPrivateMedia` or `keyring.decryptFile`
 *         throw on transport / cryptographic failure (typed by the caller).
 */
export async function downloadAndDecryptPrivate(
  mediaId: string,
  ctx?: MediaVaultContext,
): Promise<CachedMedia> {
  const cached = blobCache.get(mediaId);
  if (cached !== undefined) {
    return cached;
  }

  const keyringStore = useKeyringStore.getState();
  if (keyringStore.privateKey === null || keyringStore.publicKey === null) {
    throw new Error("Keys not loaded");
  }

  // Vault-first: verified plaintext from a previous view, no network
  // and no PGP round-trip. Works offline.
  const userId = vaultUserId();
  if (userId !== undefined) {
    const hit = await readMediaVault(userId, mediaId);
    if (hit !== undefined) {
      return cacheBytes(mediaId, hit.bytes, hit.mime);
    }
  }

  const meta = await mediaApi.downloadPrivateMedia(mediaId);
  const encrypted = base64ToBytes(meta.encrypted_file);
  const signature = base64ToBytes(meta.signature);

  // MVP: the sender's verification key is the local public key. The
  // backend stores detached signatures made with the owner's key during
  // upload, so for self-sent media this matches. Real sender-key
  // resolution from the chat roster is out of scope here.
  const senderPublicKey = keyringStore.publicKey;

  const decrypted = await keyring.decryptFile(
    encrypted,
    signature,
    senderPublicKey,
    keyringStore.privateKey,
  );

  // Write-after-verify: persist the checked plaintext best-effort.
  if (userId !== undefined) {
    void writeMediaVault(userId, {
      mediaId,
      plain: decrypted,
      mime: meta.mime_type,
      ...(ctx?.chatId !== undefined ? { chatId: ctx.chatId } : {}),
      ...(ctx?.messageId !== undefined ? { messageId: ctx.messageId } : {}),
    });
  }

  return cacheBytes(mediaId, decrypted, meta.mime_type);
}

/**
 * Download + decrypt a group-chat media attachment. Same contract as
 * {@link downloadAndDecryptPrivate} but hits the group endpoint.
 */
export async function downloadAndDecryptGroup(
  mediaId: string,
  ctx?: MediaVaultContext,
): Promise<CachedMedia> {
  const cached = blobCache.get(mediaId);
  if (cached !== undefined) {
    return cached;
  }

  const keyringStore = useKeyringStore.getState();
  if (keyringStore.privateKey === null || keyringStore.publicKey === null) {
    throw new Error("Keys not loaded");
  }

  const userId = vaultUserId();
  if (userId !== undefined) {
    const hit = await readMediaVault(userId, mediaId);
    if (hit !== undefined) {
      return cacheBytes(mediaId, hit.bytes, hit.mime);
    }
  }

  const meta = await mediaApi.downloadGroupMedia(mediaId);
  const encrypted = base64ToBytes(meta.encrypted_file);
  const signature = base64ToBytes(meta.signature);

  // See MVP note in `downloadAndDecryptPrivate`.
  const senderPublicKey = keyringStore.publicKey;

  const decrypted = await keyring.decryptFile(
    encrypted,
    signature,
    senderPublicKey,
    keyringStore.privateKey,
  );

  if (userId !== undefined) {
    void writeMediaVault(userId, {
      mediaId,
      plain: decrypted,
      mime: meta.mime_type,
      ...(ctx?.chatId !== undefined ? { chatId: ctx.chatId } : {}),
      ...(ctx?.messageId !== undefined ? { messageId: ctx.messageId } : {}),
    });
  }

  return cacheBytes(mediaId, decrypted, meta.mime_type);
}

/**
 * Vault-only peek: RAM cache, then ChaCha vault — never touches network
 * and never decrypts. Used by previews to auto-render already-stored
 * bytes without asking the user to press "load" for content that is
 * already on disk. Returns `undefined` on any miss (locked keystore
 * included) — the caller then shows the explicit load button.
 */
export async function peekVaultMedia(mediaId: string): Promise<CachedMedia | undefined> {
  const cached = blobCache.get(mediaId);
  if (cached !== undefined) {
    return cached;
  }
  const userId = vaultUserId();
  if (userId === undefined) {
    return undefined;
  }
  const hit = await readMediaVault(userId, mediaId);
  if (hit === undefined) {
    return undefined;
  }
  return cacheBytes(mediaId, hit.bytes, hit.mime);
}

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

/**
 * Decode a wire binary field into a `Uint8Array`. Server blobs
 * (`encrypted_file`, `signature`) arrive as base64 per contract but
 * have been observed as raw armor text (same DB drift as user public
 * keys) — the shared tolerant decoder accepts both shapes.
 */
function base64ToBytes(b64: string): Uint8Array {
  return decodeWireBytes(b64);
}

/**
 * Wrap the decrypted plaintext into a `Blob`, mint a `blob:` URL, and
 * register the entry in the cache. Returns the same object that's now
 * stored, so callers can hand it straight to `<img src={url}>` or to an
 * anchor's `href`.
 */
function cacheBytes(mediaId: string, bytes: Uint8Array, mime: string): CachedMedia {
  const copy: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const entry: CachedMedia = { blob, url, mime };
  blobCache.set(mediaId, entry);
  return entry;
}
