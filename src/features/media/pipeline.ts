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
 *   - Group recipient fan-out to N member keys — uploads encrypt to the
 *     single peer/group key passed via {@link MediaRecipientOptions}.
 */

import * as openpgp from "openpgp";

import * as keyring from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { useSessionStore } from "@/features/auth/sessionStore";

import * as mediaApi from "./api";
import { MAX_MEDIA_SIZE_BYTES } from "./constants";
import { writeMediaVault } from "./vault";

/**
 * Recipient override for media uploads.
 *
 * When `peerPublicKeyArmored` is a non-empty armor string, the blob is
 * encrypted to that key (peer for 1:1, group key for group chats) so the
 * other side can actually decrypt it. When omitted/empty, the upload
 * falls back to the local user's own key (notes-to-self).
 */
export interface MediaRecipientOptions {
  peerPublicKeyArmored?: string | null;
}

/**
 * Resolve media recipient keys: peer/group key when provided, own key
 * otherwise. Throws when neither is usable.
 */
async function resolveMediaRecipients(
  peerPublicKeyArmored?: string | null,
): Promise<openpgp.Key[]> {
  if (peerPublicKeyArmored !== null && peerPublicKeyArmored !== undefined) {
    if (peerPublicKeyArmored.length > 0) {
      return [await keyring.importPublicKey(peerPublicKeyArmored)];
    }
  }
  const { publicKey } = useKeyringStore.getState();
  if (publicKey !== null) return [publicKey];
  throw new Error("resolveMediaRecipients: no recipient key (peer or own) available");
}

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
export async function encryptMedia(
  file: File | Blob,
  recipientsPublicKeys: openpgp.Key[],
  signingKey: openpgp.PrivateKey,
): Promise<EncryptedMedia> {
  if (!(file instanceof Blob)) {
    throw new Error("encryptMedia: file must be a Blob or File");
  }
  if (file.size > MAX_MEDIA_SIZE_BYTES) {
    throw new Error(
      `encryptMedia: file is ${file.size} bytes, exceeds limit of ${MAX_MEDIA_SIZE_BYTES} bytes (50 MB)`,
    );
  }
  if (file.size === 0) {
    throw new Error("encryptMedia: refusing to encrypt an empty file");
  }

  const mime = file.type !== "" ? file.type : "application/octet-stream";
  const fileBytes = new Uint8Array(await file.arrayBuffer());

  const { encrypted, signature } = await keyring.encryptFile(
    fileBytes,
    recipientsPublicKeys,
    signingKey,
    mime,
  );

  return { encrypted, signature, mime, size: file.size };
}

/**
 * Encrypt a media file with the local keyring and upload it to a
 * private dialog chat.
 *
 * The blob is encrypted to the peer's key when
 * `opts.peerPublicKeyArmored` is set (so the recipient can decrypt it),
 * otherwise to the user's own key (notes-to-self fallback).
 *
 * Throws if the keyring is `empty` / `locked` — i.e. the caller is
 * trying to send before unlock completed. Surfaces the underlying
 * encryption / upload errors verbatim for the UI layer to render.
 */
export async function encryptAndUploadPrivate(
  file: File | Blob,
  chatId: string,
  opts?: MediaRecipientOptions,
): Promise<UploadedMedia> {
  const { publicKey, privateKey } = useKeyringStore.getState();
  if (publicKey === null || privateKey === null) {
    throw new Error("encryptAndUploadPrivate: keyring not ready (no public/private key)");
  }

  const recipients = await resolveMediaRecipients(opts?.peerPublicKeyArmored);
  const encrypted = await encryptMedia(file, recipients, privateKey);
  const attachment = await mediaApi.uploadPrivateMedia(chatId, {
    encrypted_file: bytesToBase64(encrypted.encrypted),
    signature: bytesToBase64(encrypted.signature),
    mime_type: encrypted.mime,
    file_size: encrypted.size,
  });
  // Own plaintext is already in hand — vault it straight away (no
  // download needed later). Best-effort, never blocks the upload result.
  const ownerId = useSessionStore.getState().user?.id;
  if (ownerId !== undefined) {
    void writeMediaVault(ownerId, {
      mediaId: attachment.id,
      plain: new Uint8Array(await file.arrayBuffer()),
      mime: encrypted.mime,
      chatId,
    });
  }
  return toUploadedMedia(attachment);
}

/**
 * Group-chat twin of {@link encryptAndUploadPrivate}. Same recipient
 * resolution (group key via `opts.peerPublicKeyArmored`, own key as
 * fallback) — the only difference is the backend route via
 * `uploadGroupMedia`.
 */
export async function encryptAndUploadGroup(
  file: File | Blob,
  chatId: string,
  opts?: MediaRecipientOptions,
): Promise<UploadedMedia> {
  const { publicKey, privateKey } = useKeyringStore.getState();
  if (publicKey === null || privateKey === null) {
    throw new Error("encryptAndUploadGroup: keyring not ready (no public/private key)");
  }

  const recipients = await resolveMediaRecipients(opts?.peerPublicKeyArmored);
  const encrypted = await encryptMedia(file, recipients, privateKey);
  const attachment = await mediaApi.uploadGroupMedia(chatId, {
    encrypted_file: bytesToBase64(encrypted.encrypted),
    signature: bytesToBase64(encrypted.signature),
    mime_type: encrypted.mime,
    file_size: encrypted.size,
  });
  const ownerId = useSessionStore.getState().user?.id;
  if (ownerId !== undefined) {
    void writeMediaVault(ownerId, {
      mediaId: attachment.id,
      plain: new Uint8Array(await file.arrayBuffer()),
      mime: encrypted.mime,
      chatId,
    });
  }
  return toUploadedMedia(attachment);
}

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
export async function encryptAndUploadMultiplePrivate(
  files: readonly File[],
  chatId: string,
  opts?: MediaRecipientOptions,
): Promise<UploadedMedia[]> {
  return Promise.all(files.map((file) => encryptAndUploadPrivate(file, chatId, opts)));
}

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

const BASE64_CHUNK = 0x8000;

/**
 * `Uint8Array → base64`.
 *
 * Chunked because `String.fromCharCode(...bytes)` blows the argument
 * limit (~64 KiB on V8) on large PGP blobs. Mirrors the encoder used
 * in `infra/apiClient` and `features/messages/mutations.ts` — kept
 * local because the media feature should not depend on the messages
 * feature (or vice versa).
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * Narrow `MediaAttachment` (TASK-070's return type) to the four
 * fields {@link UploadedMedia} documents. Done explicitly so the
 * pipeline's public contract doesn't track every future field the
 * backend might add to `MediaAttachment`.
 */
function toUploadedMedia(att: {
  id: string;
  mime_type: string;
  file_size: number;
  creation_datetime: string;
}): UploadedMedia {
  return {
    id: att.id,
    mime_type: att.mime_type,
    file_size: att.file_size,
    creation_datetime: att.creation_datetime,
  };
}
