/**
 * Send-message mutations with optimistic insert, rollback and retry.
 *
 * Flow (see `docs/design.md` §9.4 and §6.1):
 *
 *   optimistic insert (status `pending`)
 *     → encrypt + sign via keyring (TASK-012)
 *     → POST через messages/api (TASK-050)
 *     → reconcile: pending entry replaced by the server row (`sent`)
 *     → on failure: rollback to the snapshot, then re-insert the entry
 *       as `failed` so the UI can offer a retry button.
 *
 * Cache contract with `queries.ts` (TASK-051): the message list lives under
 * `["messages", "private" | "group", chatId]` as an `InfiniteData` of
 * {@link ListItems} pages. Optimistic rows are inserted into **page 0**,
 * which is assumed to hold the newest slice (see {@link insertPending}).
 *
 * MVP limitation (report_for_backend/01): there is no endpoint to fetch a
 * peer's public key yet, so every message is encrypted **to ourselves**.
 * The ciphertext is therefore readable only by the sender until the real
 * recipient-key lookup lands; swap {@link resolveRecipients} when it does.
 */
import { type InfiniteData, type UseMutationResult } from "@tanstack/react-query";
import type { DialogMessage, ListItems } from "./model";
export type ChatKind = "private" | "group";
export type MessageStatus = "pending" | "sent" | "failed";
export interface SendMessageInput {
    /**
     * The chat this message belongs to. Kept in the payload so callers can
     * pass a complete descriptor, but the mutation always uses the `chatId`
     * given to the hook — one source of truth for both the request path and
     * the cache key.
     */
    chatId: string;
    text: string;
}
/**
 * Optimistic row living in the message cache next to real
 * {@link DialogMessage} rows.
 *
 * It extends `DialogMessage` (instead of being a parallel shape) so the
 * list stays homogeneous and `MessageBubble` (TASK-053) can render it
 * without a second code path. `text` carries the plaintext we already
 * have, which lets the bubble skip decryption and lets
 * {@link useRetryMessage} re-send without touching the composer draft.
 */
export interface PendingMessage extends DialogMessage {
    status: MessageStatus;
    /** Plaintext, kept in memory only — never sent to the server as-is. */
    text: string;
    /** Epoch ms; mirrors `creation_datetime` for cheap sorting. */
    createdAt: number;
    readonly optimistic: true;
}
export type MessagesCache = InfiniteData<ListItems<DialogMessage>>;
interface SendContext {
    previous: MessagesCache | undefined;
    pending: PendingMessage;
}
export type SendMessageMutation = UseMutationResult<DialogMessage, Error, SendMessageInput, SendContext>;
/**
 * `Uint8Array → base64`.
 *
 * Chunked because `String.fromCharCode(...bytes)` blows the argument
 * limit on large PGP blobs. Mirrors `infra/apiClient`'s internal encoder;
 * we encode here (rather than leaning on the client's JSON replacer) so
 * {@link CreateMessageRequest} keeps its documented `string` fields.
 */
export declare function bytesToBase64(bytes: Uint8Array): string;
export declare function messagesQueryKey(kind: ChatKind, chatId: string): readonly unknown[];
export declare function isPendingMessage(msg: DialogMessage): msg is PendingMessage;
export declare function useSendPrivateMessage(chatId: string, peerPublicKeyArmored?: string | null): SendMessageMutation;
export declare function useSendGroupMessage(chatId: string, peerPublicKeyArmored?: string | null): SendMessageMutation;
export interface RetryMessageResult {
    /**
     * Re-send a `failed` optimistic message by its temp id. Drops the failed
     * row and runs the normal send flow (which inserts a fresh `pending`
     * row), so the message never appears twice.
     */
    retry: (messageId: string) => void;
    isRetrying: boolean;
    canRetry: (message: DialogMessage) => boolean;
}
/**
 * Retry helper for failed sends.
 *
 * The plaintext is read back from the optimistic row in the cache rather
 * than from `composerStore` — the draft is cleared as soon as the message
 * is handed off, so the cache is the only place that still knows what the
 * user typed.
 */
export declare function useRetryMessage(chatId: string, kind?: ChatKind): RetryMessageResult;
export {};
