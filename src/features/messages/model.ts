/**
 * Domain types for the messages API.
 *
 * Convention: {@link Message.encrypted_message} and {@link Message.signature}
 * are base64-encoded representations of `Uint8Array` PGP blobs (encrypted
 * ciphertext and detached signature). The shared {@link apiClient} performs
 * automatic `Uint8Array ↔ base64` conversion via a custom JSON replacer, so
 * callers may pass either form — but these wire types always declare `string`.
 *
 * @see {@link import("@/infra/apiClient").apiClient} for the transport-level
 * base64 reviver/replacer.
 */

export interface Message {
  id: string;
  owner_id: string;
  /** Base64-encoded `Uint8Array` — PGP-encrypted ciphertext. */
  encrypted_message: string;
  /** Base64-encoded `Uint8Array` — detached PGP signature. */
  signature: string;
  /** ISO-8601 timestamp string. */
  creation_datetime: string;
}

export interface DialogMessage extends Message {
  chat_id: string;
}

export interface CreateMessageRequest {
  /** Base64-encoded `Uint8Array` — PGP-encrypted ciphertext. */
  encrypted_message: string;
  /** Base64-encoded `Uint8Array` — detached PGP signature. */
  signature: string;
  media_ids?: string[];
}

/** Generic paginated list envelope used by list endpoints. */
export interface ListItems<T> {
  items: T[];
}