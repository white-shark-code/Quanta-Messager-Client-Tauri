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

export interface MediaAttachment {
  id: string;
  mime_type: string;
  file_size: number;
  creation_datetime: string;
}

export interface MediaDownload extends MediaAttachment {
  /** Base64-encoded PGP ciphertext. */
  encrypted_file: string;
  /** Base64-encoded detached PGP signature of `encrypted_file`. */
  signature: string;
  owner_id: string;
}

export interface UploadMediaRequest {
  /** Base64-encoded PGP ciphertext of the file. */
  encrypted_file: string;
  /** Base64-encoded detached PGP signature of the ciphertext. */
  signature: string;
  mime_type: string;
  file_size: number;
}

export interface ListItems<T> {
  items: T[];
}
