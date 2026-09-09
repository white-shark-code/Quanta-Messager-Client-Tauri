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
 * Drop every cached blob and revoke every URL.
 *
 * Intended for `lock()` / `logout` / "clear all" UI actions — leaving stale
 * `blob:` URLs registered would pin the underlying `Uint8Array`s in memory
 * after the keyring has been wiped.
 */
export declare function clearBlobCache(): void;
/**
 * Read-only lookup. Returns `undefined` if the media hasn't been decrypted
 * (and therefore not cached) yet.
 */
export declare function getCachedMedia(mediaId: string): CachedMedia | undefined;
/**
 * Revoke and forget a single cached entry.
 *
 * Safe to call on a missing id — it's a no-op then. Safe to call while a
 * component is still rendering the URL: the browser delays actual release
 * until the image/anchor no longer references it.
 */
export declare function revokeBlobUrl(mediaId: string): void;
/**
 * Download + decrypt a private-chat media attachment.
 *
 * @throws Error("Keys not loaded") if the keyring is in any state other
 *         than `"ready"` with a populated `privateKey` and `publicKey`.
 *         Components are expected to surface this as a "unlock first" hint.
 * @throws Whatever `mediaApi.downloadPrivateMedia` or `keyring.decryptFile`
 *         throw on transport / cryptographic failure (typed by the caller).
 */
export declare function downloadAndDecryptPrivate(mediaId: string): Promise<CachedMedia>;
/**
 * Download + decrypt a group-chat media attachment. Same contract as
 * {@link downloadAndDecryptPrivate} but hits the group endpoint.
 */
export declare function downloadAndDecryptGroup(mediaId: string): Promise<CachedMedia>;
