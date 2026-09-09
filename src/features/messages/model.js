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
export {};
