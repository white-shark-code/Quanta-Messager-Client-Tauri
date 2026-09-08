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
 *   - **No persistence:** blob URLs and `Blob` payloads live only for the
 *     current session; `clearBlobCache()` wipes them on lock / logout.
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

import * as mediaApi from "./api";

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
): Promise<CachedMedia> {
  const cached = blobCache.get(mediaId);
  if (cached !== undefined) {
    return cached;
  }

  const keyringStore = useKeyringStore.getState();
  if (keyringStore.privateKey === null || keyringStore.publicKey === null) {
    throw new Error("Keys not loaded");
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

  return cacheBytes(mediaId, decrypted, meta.mime_type);
}

/**
 * Download + decrypt a group-chat media attachment. Same contract as
 * {@link downloadAndDecryptPrivate} but hits the group endpoint.
 */
export async function downloadAndDecryptGroup(
  mediaId: string,
): Promise<CachedMedia> {
  const cached = blobCache.get(mediaId);
  if (cached !== undefined) {
    return cached;
  }

  const keyringStore = useKeyringStore.getState();
  if (keyringStore.privateKey === null || keyringStore.publicKey === null) {
    throw new Error("Keys not loaded");
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

  return cacheBytes(mediaId, decrypted, meta.mime_type);
}

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

/**
 * Decode a base64 string into a `Uint8Array`. Same shape as the helper in
 * `features/messages/queries.ts` — kept local because the two features
 * don't otherwise share a base64 utility (avoids adding a cross-feature
 * import for a 1-liner).
 */
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Wrap the decrypted plaintext into a `Blob`, mint a `blob:` URL, and
 * register the entry in the cache. Returns the same object that's now
 * stored, so callers can hand it straight to `<img src={url}>` or to an
 * anchor's `href`.
 */
function cacheBytes(mediaId: string, bytes: Uint8Array, mime: string): CachedMedia {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const entry: CachedMedia = { blob, url, mime };
  blobCache.set(mediaId, entry);
  return entry;
}
