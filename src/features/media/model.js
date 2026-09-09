/**
 * Media attachment domain types.
 *
 * Backend schemas: `MediaAttachmentResponse`, `MediaAttachmentDownload`,
 * `UploadMediaAttachment` (see `server/src/messages/schemas.py`).
 *
 * **Binary convention:** PGP-encrypted blobs (`encrypted_file`, `signature`)
 * are exchanged with the backend as **base64-encoded strings** inside JSON.
 * The apiClient reviver also accepts `Uint8Array` directly, but the typed
 * surface here uses `string` so callers know to encode before sending and
 * to decode after receiving.
 */
export {};
