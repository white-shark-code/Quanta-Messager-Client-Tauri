/**
 * Encrypt-and-upload pipeline for media attachments.
 *
 * Bridges `features/keyring` (PGP encrypt + sign, TASK-012) and
 * `features/media/api` (HTTP upload, TASK-070) into a single call
 * surface so message composers and `MediaPreview` don't have to know
 * about the two layers.
 *
 * Design constraints (see `docs/design.md` §5.1.3):
 *   - Encryption + signing happen **before** JSON serialization.
 *   - Only `bytes → base64` leaves the client.
 *   - The size check runs before encryption so we don't burn CPU on a
 *     blob the server would reject anyway.
 *
 * Out of scope here:
 *   - Upload progress (TASK-074).
 *   - Decryption / caching (TASK-072, `features/media/decrypt.ts`).
 *   - Group recipient fan-out — MVP uploads are encrypted to the user's
 *     own public key, matching the MVP "notes to self" chat model. The
 *     helper still takes an explicit `recipientsPublicKeys` argument on
 *     {@link encryptMedia} so a multi-recipient upgrade (group chats
 *     with shared encryption keys) is a pure call-site change.
 */
import * as openpgp from "openpgp";
/**
 * Result of {@link encryptMedia}: the ciphertext + detached signature
 * of the *plaintext* file, plus the bookkeeping the upload request
 * needs (`mime`, original `size` in bytes).
 *
 * `size` is the **plaintext** file size, not the armored/encrypted
 * payload size — the backend stores `file_size` for accounting and
 * quota, both of which are based on the user-visible file.
 */
export interface EncryptedMedia {
    encrypted: Uint8Array;
    signature: Uint8Array;
    mime: string;
    size: number;
}
/**
 * Server response shape after a successful media upload. Mirrors
 * `MediaAttachment` in `./model.ts` but stripped to the four fields the
 * caller actually needs — id (to attach to a message) + the three
 * echoed metadata fields.
 */
export interface UploadedMedia {
    id: string;
    mime_type: string;
    file_size: number;
    creation_datetime: string;
}
/**
 * Encrypt + sign a media file for the given recipient set.
 *
 * The size guard runs **before** `keyring.encryptFile` is called so a
 * 100 MB upload fails in microseconds, not after a multi-second RSA /
 * ECC round-trip. The MIME fallback to `application/octet-stream`
 * matches the backend's accepted default and keeps the upload valid
 * when the browser doesn't know the file type (e.g. some virtualised
 * file pickers).
 *
 * @param file - The plaintext media blob. Both `File` (drag-and-drop,
 *   `<input type="file">`) and `Blob` (drag preview, clipboard paste)
 *   are supported; both expose the `arrayBuffer()` / `size` / `type`
 *   triple we need.
 * @param recipientsPublicKeys - One or more PGP public keys. For MVP
 *   private chats this is `[keyringStore.publicKey]` (encrypt-to-self);
 *   group fan-out will eventually pass N keys.
 * @param signingKey - The unlocked sender private key.
 */
export declare function encryptMedia(file: File | Blob, recipientsPublicKeys: openpgp.Key[], signingKey: openpgp.PrivateKey): Promise<EncryptedMedia>;
/**
 * Encrypt a media file with the local keyring and upload it to a
 * private dialog chat.
 *
 * MVP behaviour: encrypts to the user's own public key
 * (`keyringStore.publicKey`) and signs with the unlocked private key.
 * The receiver is identical to the sender in the MVP chat model (no
 * recipient list yet), so this round-trips correctly for self-notes.
 *
 * Throws if the keyring is `empty` / `locked` — i.e. the caller is
 * trying to send before unlock completed. Surfaces the underlying
 * encryption / upload errors verbatim for the UI layer to render.
 */
export declare function encryptAndUploadPrivate(file: File | Blob, chatId: string): Promise<UploadedMedia>;
/**
 * Group-chat twin of {@link encryptAndUploadPrivate}. Same encryption
 * (self-keyed) and same request shape — the only difference is the
 * backend route via `uploadGroupMedia`.
 */
export declare function encryptAndUploadGroup(file: File | Blob, chatId: string): Promise<UploadedMedia>;
/**
 * Encrypt + upload multiple files in parallel.
 *
 * `Promise.all` is the right primitive here: every file is independent
 * (no shared mutable state, no per-file dependency), the browser
 * already multiplexes HTTP/2 streams, and openpgp's internal worker
 * pool handles concurrent encrypt calls. The total wall time is
 * `max(per-file time)` instead of the sequential sum.
 *
 * **All-or-nothing semantics.** If any upload fails, `Promise.all`
 * rejects and the remaining uploads continue running in the
 * background — there is no built-in cancellation. The TODO in the
 * task description notes a `Promise.allSettled` upgrade for partial
 * success; deferred until a UI use case actually needs it.
 */
export declare function encryptAndUploadMultiplePrivate(files: readonly File[], chatId: string): Promise<UploadedMedia[]>;
