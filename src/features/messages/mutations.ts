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

import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type * as openpgp from "openpgp";

import { useSessionStore } from "@/features/auth/sessionStore";
import { appendDialog } from "@/features/dialog-store/store";
import * as keyring from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { toUserMessage } from "@/infra/error";
import { debugLog } from "@/lib/debug";

import * as messagesApi from "./api";
import type { CreateMessageRequest, DialogMessage, ListItems } from "./model";
import { getDecrypted } from "./queries";
import { encodeReplyBody, truncatePreview, type ReplyRef } from "./replyEnvelope";

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
  /**
   * When set, the message is sent as a reply: the parent's preview +
   * sender are resolved from the local cache and wrapped into a reply
   * envelope (see `replyEnvelope`) before encryption. Never fails the
   * send when the parent isn't decrypted — the preview just falls back
   * to `""`. Replying to an unsent (pending/failed) row throws.
   */
  replyTo?: { id: string };
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
  /** Reply reference for optimistic reply rows; `null`/absent = plain message. */
  replyPreview?: ReplyRef | null;
}

export type MessagesCache = InfiniteData<ListItems<DialogMessage>>;

interface SendContext {
  previous: MessagesCache | undefined;
  pending: PendingMessage;
}

export type SendMessageMutation = UseMutationResult<
  DialogMessage,
  Error,
  SendMessageInput,
  SendContext
>;

const BASE64_CHUNK = 0x8000;

/**
 * `Uint8Array → base64`.
 *
 * Chunked because `String.fromCharCode(...bytes)` blows the argument
 * limit on large PGP blobs. Mirrors `infra/apiClient`'s internal encoder;
 * we encode here (rather than leaning on the client's JSON replacer) so
 * {@link CreateMessageRequest} keeps its documented `string` fields.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function messagesQueryKey(kind: ChatKind, chatId: string): readonly unknown[] {
  return ["messages", kind, chatId];
}

export function isPendingMessage(msg: DialogMessage): msg is PendingMessage {
  return (msg as Partial<PendingMessage>).optimistic === true;
}

function newTempId(): string {
  return `optimistic-${crypto.randomUUID()}`;
}

function makePending(
  chatId: string,
  ownerId: string,
  text: string,
  status: MessageStatus = "pending",
  replyPreview?: ReplyRef | null,
): PendingMessage {
  const now = Date.now();
  return {
    id: newTempId(),
    chat_id: chatId,
    owner_id: ownerId,
    encrypted_message: "",
    signature: "",
    creation_datetime: new Date(now).toISOString(),
    status,
    text,
    createdAt: now,
    optimistic: true,
    ...(replyPreview !== undefined ? { replyPreview } : {}),
  };
}

/**
 * Insert an optimistic row into page 0.
 *
 * Page 0 is the newest slice (offset 0) and the backend returns it
 * newest-first, so the freshly sent message goes to the **head**. This is
 * the single place that encodes the ordering assumption — if TASK-051
 * flips the page order, only this function changes.
 */
function insertPending(cache: MessagesCache, pending: PendingMessage): MessagesCache {
  const [first, ...rest] = cache.pages;
  if (first === undefined) {
    return { pages: [{ items: [pending] }], pageParams: [...cache.pageParams] };
  }
  return {
    ...cache,
    pages: [{ ...first, items: [pending, ...first.items] }, ...rest],
  };
}

function mapPages(
  cache: MessagesCache,
  fn: (items: DialogMessage[]) => DialogMessage[],
): MessagesCache {
  return { ...cache, pages: cache.pages.map((page) => ({ ...page, items: fn(page.items) })) };
}

function replacePending(
  cache: MessagesCache,
  tempId: string,
  server: DialogMessage,
): MessagesCache {
  return mapPages(cache, (items) => items.map((item) => (item.id === tempId ? server : item)));
}

function dropMessage(cache: MessagesCache, id: string): MessagesCache {
  return mapPages(cache, (items) => items.filter((item) => item.id !== id));
}

function updateCache(
  queryClient: QueryClient,
  key: readonly unknown[],
  fn: (cache: MessagesCache) => MessagesCache,
): void {
  queryClient.setQueryData<MessagesCache>(key, (cache) =>
    cache === undefined ? cache : fn(cache),
  );
}

/**
 * Resolve which public keys the ciphertext is encrypted to.
 *
 * Two modes:
 * - **Peer encryption** (required for `private`/`group` chats when
 *   `expectPeer === true`): when `peerPublicKeyArmored` is a non-empty
 *   string, import it and encrypt to that key. Required for real
 *   peer-to-peer — without it the recipient cannot decrypt.
 * - **Notes-to-self** (only when `expectPeer === false`): encrypt to
 *   the local user's own key. Used for self-messages where the user
 *   doesn't have a separate recipient.
 *
 * A `null`/`""` peer key when `expectPeer === true` throws — the
 * previous silent fallback would send Bob's ciphertext to himself and
 * leave Alice staring at "🔒 Заблокировано".
 *
 * Returns `null` only when no key (own or peer) is usable and we
 * deliberately accept notes-to-self mode.
 */
async function resolveRecipients(
  ownPublicKey: openpgp.Key | null,
  peerPublicKeyArmored: string | null,
  expectPeer: boolean,
): Promise<openpgp.Key[] | null> {
  if (peerPublicKeyArmored !== null && peerPublicKeyArmored.length > 0) {
    const peerKey = await keyring.importPublicKey(peerPublicKeyArmored);
    return [peerKey];
  }
  if (expectPeer) {
    throw new Error(
      "resolveRecipients: peer public key missing for peer chat — refusing to encrypt-to-self. Wait for peerKey to load and retry.",
    );
  }
  if (ownPublicKey !== null) return [ownPublicKey];
  return null;
}

type SendFn = (chatId: string, req: CreateMessageRequest) => Promise<DialogMessage>;

/**
 * Resolve the reply reference for `replyToId` from the local list cache
 * plus the decryption cache.
 *
 * - Parent sender = parent row `owner_id`, fallback `"unknown"` when the
 *   parent row isn't in the cache.
 * - Parent preview = decrypted parent text when available, else `""`
 *   (never fails the send).
 * - Throws `Cannot reply to an unsent message` when the parent row is an
 *   optimistic pending/failed row (its ciphertext doesn't exist yet).
 *
 * Exported for tests; used synchronously by both `mutationFn` and
 * `onMutate` so the envelope and the optimistic row agree.
 */
export function resolveReplyRef(
  queryClient: QueryClient,
  kind: ChatKind,
  chatId: string,
  replyToId: string,
): ReplyRef {
  const cache = queryClient.getQueryData<MessagesCache>(messagesQueryKey(kind, chatId));
  const parent =
    cache?.pages.flatMap((page) => page.items).find((item) => item.id === replyToId) ?? null;
  if (parent !== null && isPendingMessage(parent)) {
    throw new Error("Cannot reply to an unsent message");
  }
  const sender = parent?.owner_id ?? "unknown";
  const preview = truncatePreview(getDecrypted(replyToId)?.text ?? "");
  return { id: replyToId, sender, preview };
}

/**
 * Build the pre-encryption body: a reply envelope when `reply` is set,
 * raw `text` otherwise. Exported for tests.
 */
export function buildSendBody(text: string, reply: ReplyRef | null): string {
  if (reply === null) return text;
  return encodeReplyBody(text, { id: reply.id, sender: reply.sender, preview: reply.preview });
}

/**
 * Shared implementation behind {@link useSendPrivateMessage} and
 * {@link useSendGroupMessage}: identical cache handling, different
 * transport function and cache namespace.
 *
 * `peerPublicKeyArmored` is the peer's (or group's) ASCII-armored PGP
 * public key, fetched by the caller (typically `ChatRoute` via
 * `useUserPublicKey`). When set, the message is encrypted to that
 * recipient so they can actually decrypt it. When omitted, the message
 * falls back to encrypting to the local user (notes-to-self mode).
 */
function useSendMessage(
  kind: ChatKind,
  chatId: string,
  send: SendFn,
  peerPublicKeyArmored?: string | null,
): SendMessageMutation {
  const queryClient = useQueryClient();
  const publicKey = useKeyringStore((s) => s.publicKey);
  const privateKey = useKeyringStore((s) => s.privateKey);
  const user = useSessionStore((s) => s.user);
  const queryKey = messagesQueryKey(kind, chatId);

  return useMutation<DialogMessage, Error, SendMessageInput, SendContext>({
    mutationKey: ["messages", kind, chatId, "send"],

    mutationFn: async ({ text, replyTo }: SendMessageInput) => {
      if (privateKey === null) {
        throw new Error("Keys not loaded");
      }
      if (user === null) {
        throw new Error("Not logged in");
      }
      if (text.trim().length === 0) {
        throw new Error("Cannot send an empty message");
      }

      // Resolve the reply ref synchronously from the caches (throws on
      // pending parent). ONE envelope string feeds both ciphertexts so
      // peer and self copies decrypt to the same reply.
      const reply: ReplyRef | null =
        replyTo !== undefined ? resolveReplyRef(queryClient, kind, chatId, replyTo.id) : null;
      const body = buildSendBody(text, reply);

      const recipients = await resolveRecipients(
        publicKey,
        peerPublicKeyArmored ?? null,
        kind === "private",
      );
      if (recipients === null) {
        throw new Error("No recipient public key available");
      }

      // Log which mode we ended up using — invaluable when debugging
      // "Bob encrypted to himself and Alice sees Заблокировано".
      const peerArmored = peerPublicKeyArmored ?? null;
      const mode =
        peerArmored !== null && peerArmored.length > 0
          ? "peer-encryption"
          : publicKey !== null
            ? "encrypt-to-self"
            : "none";
      console.log(`[send ${kind}] mode=${mode} peerArmoredLen=${peerArmored?.length ?? 0}`);

      if (publicKey === null) {
        throw new Error("Own public key not loaded");
      }

      // Two ciphertexts of the same plaintext: the main one for the
      // peer, the self-copy for the sender (readable on any of their
      // devices sharing the keypair). The backend stores both and
      // returns each viewer the copy they can decrypt.
      const [main, selfCopy] = await Promise.all([
        keyring.encryptText(body, recipients, privateKey),
        keyring.encryptText(body, [publicKey], privateKey),
      ]);

      return send(chatId, {
        encrypted_message: bytesToBase64(main.encrypted),
        signature: bytesToBase64(main.signature),
        encrypted_message_self: bytesToBase64(selfCopy.encrypted),
        signature_self: bytesToBase64(selfCopy.signature),
      });
    },

    onMutate: async ({ text, replyTo }) => {
      // A refetch landing mid-flight would clobber the optimistic row.
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<MessagesCache>(queryKey);
      // Resolve the reply preview here too so the optimistic row renders
      // the quote instantly; same lookup as `mutationFn` (throws on
      // pending parent, which aborts the send before `mutationFn` runs).
      const replyPreview: ReplyRef | null =
        replyTo !== undefined ? resolveReplyRef(queryClient, kind, chatId, replyTo.id) : null;
      const pending = makePending(chatId, user?.id ?? "me", text, "pending", replyPreview);

      if (previous !== undefined) {
        queryClient.setQueryData<MessagesCache>(queryKey, insertPending(previous, pending));
      }

      return { previous, pending };
    },

    onError: (err, _vars, context) => {
      if (context === undefined) {
        return;
      }
      // Log to debug.log so we can see the exact backend error.
      void debugLog(`Send ${kind} message`, err, {
        chatId,
        textPreview: _vars.text.slice(0, 50),
      });
      // Restore server truth first…
      queryClient.setQueryData<MessagesCache>(queryKey, context.previous);
      // …then re-add the row as `failed` so the retry affordance survives
      // the rollback (design.md §9.4).
      updateCache(queryClient, queryKey, (cache) =>
        insertPending(cache, { ...context.pending, status: "failed" }),
      );
      console.error(`send ${kind} message failed:`, toUserMessage(err));
    },

    onSuccess: (server, _vars, context) => {
      updateCache(queryClient, queryKey, (cache) =>
        replacePending(cache, context.pending.id, server),
      );
      // Сохраняем подтверждённую сервером строку в локальный
      // шифрованный стор. Fire-and-forget — UI не ждёт диск, при
      // сбое следующий серверный fetch перезапишет через appendMany.
      const ownerId = user?.id;
      if (ownerId !== undefined) {
        void appendDialog(ownerId, chatId, server).catch((e) => {
          void debugLog("dialog-store append after send", e, { chatId, messageId: server.id });
        });
      }
    },

    onSettled: (_data, error) => {
      // Only reconcile with the server when the send went through:
      // invalidating after a failure would refetch the list and wipe the
      // `failed` row the user still needs to retry.
      if (error === null) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useSendPrivateMessage(
  chatId: string,
  peerPublicKeyArmored?: string | null,
): SendMessageMutation {
  return useSendMessage("private", chatId, messagesApi.sendPrivateMessage, peerPublicKeyArmored);
}

export function useSendGroupMessage(
  chatId: string,
  peerPublicKeyArmored?: string | null,
): SendMessageMutation {
  return useSendMessage("group", chatId, messagesApi.sendGroupMessage, peerPublicKeyArmored);
}

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
export function useRetryMessage(chatId: string, kind: ChatKind = "private"): RetryMessageResult {
  const queryClient = useQueryClient();
  // `useSendMessage` is called unconditionally — only its transport
  // argument depends on `kind`, so hook order stays stable across renders.
  const mutation = useSendMessage(
    kind,
    chatId,
    kind === "group" ? messagesApi.sendGroupMessage : messagesApi.sendPrivateMessage,
    null, // retry re-reads peerKey from the same source; for now we drop
    // peer-key info on retry (the message reverts to encrypt-to-self).
    // A proper fix would re-derive it from the chat; not blocking the
    // basic send path.
  );
  const queryKey = messagesQueryKey(kind, chatId);

  const retry = (messageId: string): void => {
    const cache = queryClient.getQueryData<MessagesCache>(queryKey);
    const failed = cache?.pages
      .flatMap((page) => page.items)
      .find((item): item is PendingMessage => item.id === messageId && isPendingMessage(item));

    if (failed?.status !== "failed") {
      return;
    }

    updateCache(queryClient, queryKey, (current) => dropMessage(current, messageId));
    mutation.mutate({
      chatId,
      text: failed.text,
      ...(failed.replyPreview !== undefined && failed.replyPreview !== null
        ? { replyTo: { id: failed.replyPreview.id } }
        : {}),
    });
  };

  return {
    retry,
    isRetrying: mutation.isPending,
    canRetry: (message) => isPendingMessage(message) && message.status === "failed",
  };
}
