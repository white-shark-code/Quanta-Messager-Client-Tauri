/**
 * Forward messages between chats (Track B).
 *
 * RECON FINDINGS (media pipeline — `src/features/media/{decrypt, pipeline, api, model}.ts`):
 * - Media blobs are encrypted CLIENT-side with `keyring.encryptFile` (PGP to
 *   recipient keys + detached signature over the ciphertext for the backend).
 *   The MVP upload path (`encryptAndUploadPrivate/Group`) encrypts to the
 *   user's OWN public key, and the download path (`downloadAndDecrypt*`)
 *   decrypts with the own private key — i.e. blobs are encrypted under keys
 *   the client holds. There is NO server-side-only key involved.
 * - Therefore decrypt-then-re-encrypt IS possible: `download*Media(mediaId)`
 *   → `decodeWireBytes` (base64-tolerant) → `keyring.decryptFile` (own
 *   private key, own public key as the MVP sender key) → `keyring.encryptFile`
 *   to the TARGET recipients → `upload*Media(targetChatId, req)`.
 * - Upload contract (`UploadMediaRequest`): `{ encrypted_file, signature }`
 *   as base64 strings + plaintext `{ mime_type, file_size }`; routes
 *   `POST /messages/private-message/{chat_id}/media/upload` (private) and
 *   `POST /group-messages/group-message/{chat_id}/media/upload` (group).
 * - Source media is enumerated per MESSAGE via `listPrivateMedia(messageId)` /
 *   `listGroupMedia(messageId)` (`GET .../{message_id}/media/`), and fetched
 *   per ATTACHMENT via `downloadPrivateMedia(mediaId)` /
 *   `downloadGroupMedia(mediaId)`. Forwarded uploads go through the
 *   TARGET chat's upload endpoint; the returned attachment ids are passed as
 *   `media_ids` on the send (`CreateMessageRequest.media_ids?`).
 * - Per-media failure never blocks the text: the file is skipped, counted in
 *   `mediaSkipped[msgId]`, and the send proceeds without it.
 *
 * Text path: the inner text comes from the decryption cache
 * (`getDecrypted(id).text` — already envelope-unwrapped, so reply links are
 * implicitly stripped) and is re-wrapped with `encodeForwardBody(text,
 * { fromChat, fromMsg })`, then encrypted with the SAME dual-copy scheme as
 * `useSendMessage` (peer copy + self copy of one envelope string).
 *
 * No React, no cache writes, no backend changes. Message-list lookup reads
 * the React-Query cache via the passed `queryClient` + `messagesQueryKey`
 * (same key shape as `queries.ts`/`mutations.ts`); everything else is
 * imported directly so unit tests can `vi.mock` it.
 */

import type { QueryClient } from "@tanstack/react-query";
import type * as openpgp from "openpgp";

import * as keyring from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import * as mediaApi from "@/features/media/api";
import { decodeWireBytes } from "@/lib/wire";

import * as messagesApi from "./api";
import type { CreateMessageRequest, DialogMessage } from "./model";
import {
  bytesToBase64,
  isPendingMessage,
  messagesQueryKey,
  resolveRecipients,
  type ChatKind,
  type MessagesCache,
  type PendingMessage,
} from "./mutations";
import { getDecrypted } from "./queries";
import { encodeForwardBody } from "./replyEnvelope";

/** Why a source message was not forwarded. */
export type ForwardSkipReason = "pending" | "locked" | "media-only";

export interface ForwardSkipped {
  id: string;
  reason: ForwardSkipReason;
}

export interface ForwardResult {
  /** Server-assigned ids of the sent copies, in `messageIds` order. */
  sent: string[];
  skipped: ForwardSkipped[];
  /**
   * Per-source-message count of media attachments that could not be
   * re-encrypted/re-uploaded (download/decrypt/re-encrypt/upload failure, or
   * key-less skip). Absent key = zero skipped files for that message.
   */
  mediaSkipped: Record<string, number>;
}

export interface ForwardOptions {
  queryClient: QueryClient;
  sourceChatId: string;
  sourceKind: ChatKind;
  targetChatId: string;
  targetKind: ChatKind;
  /** Target chat's peer/group key armor; `null` = notes-to-self fallback (group only). */
  targetPeerKeyArmored: string | null;
  /** Source message ids, forwarded sequentially in this order. */
  messageIds: string[];
}

/**
 * Forward cached messages from one chat to another.
 *
 * Per message: pending/failed rows → skip `pending`; missing row or
 * undecrypted/empty text → skip `locked` (`media-only` when the row carries
 * attachments but no decryptable text — there is no text body to send, and
 * media-only sends are out of scope); otherwise encrypt
 * `encodeForwardBody(text, { fromChat, fromMsg })` to the target recipients
 * (dual-copy, same as `useSendMessage`) with re-encrypted media attached.
 *
 * Sends run sequentially (await in loop) to preserve order and avoid
 * keystore contention. A send failure rejects the whole call — already-sent
 * ids are lost to the caller then; the UI forwards small selections where a
 * retry re-sends the remainder (ids are idempotent from the user's view).
 *
 * @throws Error("Keys not loaded") when the keyring holds no keypair.
 * @throws Whatever `resolveRecipients` / `keyring` / `messagesApi` throw on
 *         recipient, crypto, or transport failure.
 */
export async function forwardMessages(opts: ForwardOptions): Promise<ForwardResult> {
  const {
    queryClient,
    sourceChatId,
    sourceKind,
    targetChatId,
    targetKind,
    targetPeerKeyArmored,
    messageIds,
  } = opts;

  const { publicKey, privateKey } = useKeyringStore.getState();
  if (privateKey === null || publicKey === null) {
    throw new Error("forwardMessages: Keys not loaded");
  }
  const recipients = await resolveRecipients(
    publicKey,
    targetPeerKeyArmored,
    targetKind === "private",
  );
  if (recipients === null) {
    throw new Error("forwardMessages: No recipient public key available");
  }

  const cache = queryClient.getQueryData<MessagesCache>(messagesQueryKey(sourceKind, sourceChatId));
  const byId = new Map<string, DialogMessage>();
  for (const item of cache?.pages.flatMap((page) => page.items) ?? []) {
    byId.set(item.id, item);
  }

  const send =
    targetKind === "private" ? messagesApi.sendPrivateMessage : messagesApi.sendGroupMessage;

  const result: ForwardResult = { sent: [], skipped: [], mediaSkipped: {} };
  for (const id of messageIds) {
    const row = byId.get(id) ?? null;
    if (row === null) {
      result.skipped.push({ id, reason: "locked" });
      continue;
    }
    if (isPendingMessage(row) || (row as Partial<PendingMessage>).status === "failed") {
      result.skipped.push({ id, reason: "pending" });
      continue;
    }
    // Already envelope-unwrapped by the decrypt path — use as-is (any reply
    // link from the source message is implicitly dropped here).
    const text = getDecrypted(id)?.text ?? "";
    if (text.length === 0) {
      const reason = (await hasSourceMedia(sourceKind, id).catch(() => false))
        ? "media-only"
        : "locked";
      result.skipped.push({ id, reason });
      continue;
    }

    const body = encodeForwardBody(text, { fromChat: sourceChatId, fromMsg: id });
    const [main, selfCopy] = await Promise.all([
      keyring.encryptText(body, recipients, privateKey),
      keyring.encryptText(body, [publicKey], privateKey),
    ]);
    const req: CreateMessageRequest = {
      encrypted_message: bytesToBase64(main.encrypted),
      signature: bytesToBase64(main.signature),
      encrypted_message_self: bytesToBase64(selfCopy.encrypted),
      signature_self: bytesToBase64(selfCopy.signature),
    };
    const mediaIds = await reencryptMedia(
      sourceKind,
      targetKind,
      targetChatId,
      id,
      recipients,
      result.mediaSkipped,
    );
    if (mediaIds.length > 0) {
      req.media_ids = mediaIds;
    }
    const server = await send(targetChatId, req);
    result.sent.push(server.id);
  }
  return result;
}

/**
 * Best-effort check whether a source message carries any media attachment.
 * Used only to pick the skip reason for text-less rows (`media-only` vs
 * `locked`). Never throws — list failure reads as "no media".
 */
async function hasSourceMedia(sourceKind: ChatKind, messageId: string): Promise<boolean> {
  const list = sourceKind === "private" ? mediaApi.listPrivateMedia : mediaApi.listGroupMedia;
  try {
    const res = await list(messageId);
    return res.items.length > 0;
  } catch {
    return false;
  }
}

/**
 * Re-encrypt every media attachment of a source message to the target
 * recipients and upload it to the target chat. Returns the new attachment
 * ids for `media_ids`. Any per-file failure skips that file and bumps
 * `mediaSkipped[messageId]`; never throws.
 */
async function reencryptMedia(
  sourceKind: ChatKind,
  targetKind: ChatKind,
  targetChatId: string,
  messageId: string,
  recipients: openpgp.Key[],
  mediaSkipped: Record<string, number>,
): Promise<string[]> {
  const { publicKey, privateKey } = useKeyringStore.getState();
  if (publicKey === null || privateKey === null) {
    return [];
  }
  const list = sourceKind === "private" ? mediaApi.listPrivateMedia : mediaApi.listGroupMedia;
  const download =
    sourceKind === "private" ? mediaApi.downloadPrivateMedia : mediaApi.downloadGroupMedia;
  const upload = targetKind === "private" ? mediaApi.uploadPrivateMedia : mediaApi.uploadGroupMedia;

  let items: Awaited<ReturnType<typeof list>>["items"];
  try {
    items = (await list(messageId)).items;
  } catch {
    return [];
  }

  const ids: string[] = [];
  for (const item of items) {
    try {
      const meta = await download(item.id);
      const encrypted = decodeWireBytes(meta.encrypted_file);
      const signature = decodeWireBytes(meta.signature);
      // MVP sender-key convention (same as `media/decrypt.ts`): blobs are
      // verified against the local public key.
      const plain = await keyring.decryptFile(encrypted, signature, publicKey, privateKey);
      const reencrypted = await keyring.encryptFile(plain, recipients, privateKey, meta.mime_type);
      const uploaded = await upload(targetChatId, {
        encrypted_file: bytesToBase64(reencrypted.encrypted),
        signature: bytesToBase64(reencrypted.signature),
        mime_type: meta.mime_type,
        file_size: plain.length,
      });
      ids.push(uploaded.id);
    } catch {
      mediaSkipped[messageId] = (mediaSkipped[messageId] ?? 0) + 1;
    }
  }
  return ids;
}
