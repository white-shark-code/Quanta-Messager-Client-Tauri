/**
 * React Query hooks for the messages API (TASK-051).
 *
 * Two layers of caching live here:
 *
 *   1. **Pagination cache (TanStack Query)** — `useInfiniteQuery` with a
 *      key of `['messages', 'private' | 'group', chatId]`. The server
 *      returns pages in *oldest-first* order; the `select` transform
 *      flattens all loaded pages and reverses them so the UI can render
 *      newest-first without per-message sorting. The query cache
 *      survives chat switches because the keys are per-`chatId`.
 *
 *   2. **Decryption cache (in-memory `Map`)** — once we've decrypted a
 *      message we keep `{ text, verified }` keyed by `messageId`.
 *      Re-renders that re-touch the same message (re-mount, scroll
 *      virtualization, hot reload) re-use the cached plaintext instead
 *      of running the (expensive) OpenPGP decrypt again. The cache is
 *      wiped by `clearDecryptedCache()` on lock / logout — once the
 *      private key is gone the cached plaintexts are the only remaining
 *      copy of the cleartext message, and they must not survive a lock
 *      boundary.
 *
 * Decryption is **lazy**: messages are not decrypted at fetch time.
 * The caller (typically `MessageBubble` in TASK-053) calls
 * `useDecryptedMessage` per visible message; React Query handles
 * per-message fetching + caching so decryption runs at most once per
 * `messageId`.
 *
 * `useDecryptedMessage` is `enabled` only when `keyringStore.privateKey`
 * is non-null AND the encrypted payload is non-empty. The latter
 * guards against two cases:
 *   - pending / failed optimistic messages (`PendingMessage` always has
 *     empty `encrypted_message` / `signature` — encryption hasn't
 *     happened yet, or the send failed), and
 *   - defensive: any real message where the server returned an empty
 *     payload (shouldn't happen, but we shouldn't crash on it).
 * When disabled the query stays idle and `data` stays `undefined`, so
 * the UI is expected to render a "🔒 Locked" placeholder.
 *
 * Sender-key resolution: `MessageBubble` resolves the sender's key via
 * the existing per-user public-key endpoint
 * (`useUserPublicKey(message.owner_id)`, cached per user id) and passes
 * it as `senderPublicKeyArmored`, so peer messages verify against the
 * real sender key. When no sender key is available (own messages, or a
 * peer that hasn't uploaded a key) verification falls back to the
 * current user's own public key — correct for self-messages, honest
 * `verified: false` otherwise. Decryption itself always uses the local
 * private key and works in both cases because the backend hands each
 * viewer the ciphertext copy they can open.
 */

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type * as openpgp from "openpgp";

import { useKeyringStore } from "@/features/keyring/keyringStore";
import * as keyring from "@/features/keyring/encrypt";
import { debugLog } from "@/lib/debug";
import { decodeWireBytes } from "@/lib/wire";
import { appendManyDialog } from "@/features/dialog-store/store";
import { useSessionStore } from "@/features/auth/sessionStore";

import * as messagesApi from "./api";
import type { DialogMessage, ListItems } from "./model";
import { decodeBody, type ReplyRef } from "./replyEnvelope";

/* ------------------------------------------------------------------ *
 * Decryption cache (in-memory, not React-Query-managed)
 * ------------------------------------------------------------------ */

/** A decrypted message — plaintext + signature-verification result. */
export interface DecryptedMessage {
  text: string;
  verified: boolean;
  reply: ReplyRef | null;
}

/**
 * Module-scoped map. Keyed by `messageId` PLUS the sender key used for
 * verification (see {@link decryptCacheKey}): the same message first
 * decrypted before the sender lookup resolves (verified against the
 * fallback own key → `verified: false`) must not satisfy a later
 * lookup carrying the real sender key — otherwise the first `false`
 * sticks forever under `staleTime: Infinity`. Lives for the lifetime
 * of the JS context — wiped by {@link clearDecryptedCache} on lock /
 * logout. Not persisted; never reaches the server.
 */
const decryptedCache = new Map<string, DecryptedMessage>();

/**
 * Build the {@link decryptedCache} key. `undefined` sender means the
 * own-key fallback path; any armor string addresses its own slot so a
 * later-arriving sender key triggers a genuine re-decrypt +
 * re-verify instead of replaying the fallback result.
 */
function decryptCacheKey(messageId: string, senderPublicKeyArmored?: string): string {
  return senderPublicKeyArmored === undefined
    ? `${messageId}:self`
    : `${messageId}:peer:${senderPublicKeyArmored}`;
}

/**
 * Wipe the entire decryption cache. Call on lock / logout — once the
 * private key is gone, the cached plaintexts are the only remaining
 * copy of the cleartext message, and they must not survive a lock
 * boundary.
 */
export function clearDecryptedCache(): void {
  decryptedCache.clear();
}

/**
 * Manual read-access to the decryption cache. Returns the self-verified
 * entry when present, else the first peer-verified entry for the id, else
 * `undefined` (message hasn't decrypted yet). Lets non-React code
 * (logging, tests) peek without subscribing to a query.
 */
export function getDecrypted(id: string): DecryptedMessage | undefined {
  const self = decryptedCache.get(decryptCacheKey(id));
  if (self !== undefined) return self;
  for (const [key, value] of decryptedCache) {
    if (key.startsWith(`${id}:peer:`)) return value;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Decryption helper (shared by `decryptMessage` and `useDecryptedMessage`)
 * ------------------------------------------------------------------ */

interface DecryptDeps {
  privateKey: openpgp.PrivateKey | null;
  publicKey: openpgp.Key | null;
}

async function tryDecrypt(
  msg: DialogMessage,
  deps: DecryptDeps,
  senderPublicKeyArmored?: string,
): Promise<DecryptedMessage | null> {
  const { privateKey, publicKey } = deps;
  if (privateKey === null) {
    return null;
  }

  // MVP: fall back to the current user's own public key. Correct for
  // notes-to-self; will mis-verify for real correspondents until the
  // backend ships the per-message sender-key endpoint (see
  // `.agents/report_for_backend/01`).
  let senderKey: openpgp.Key | null = publicKey;
  if (senderPublicKeyArmored !== undefined && senderPublicKeyArmored.length > 0) {
    senderKey = await keyring.importPublicKey(senderPublicKeyArmored);
  }
  if (senderKey === null) {
    return null;
  }

  const encrypted = decodeWireBytes(msg.encrypted_message);
  // Pre-migration messages have `signature: null`. The decrypt path
  // accepts the empty Uint8Array as "no detached signature provided"
  // — verification still runs on the embedded plaintext signature.
  const signature =
    msg.signature !== null && msg.signature.length > 0
      ? decodeWireBytes(msg.signature)
      : new Uint8Array(0);

  // `decryptText` throws on actual decrypt failure (no matching key,
  // corrupt ciphertext). Wire decoding above can also throw on garbage
  // payloads — both surface as `null` so the UI renders a placeholder
  // rather than crashing the list, with the failure in the debug log.
  try {
    const { text, verified } = await keyring.decryptText(
      encrypted,
      signature,
      senderKey,
      privateKey,
    );
    // Replies arrive as a JSON envelope inside the ciphertext — split it
    // back into display text + reply ref. Plain messages (raw text,
    // non-JSON, invalid shape) fall back to `{ text: plaintext, reply: null }`.
    const parsed = decodeBody(text);
    return { text: parsed.text, verified, reply: parsed.reply };
  } catch (e) {
    void debugLog("Decrypt message", e, {
      messageId: msg.id,
      encryptedLen: encrypted.length,
      signatureLen: signature.length,
      hasSenderKey: senderKey !== null,
      hasPrivateKey: privateKey !== null,
    });
    return null;
  }
}

async function decryptMessage(
  msg: DialogMessage,
  senderPublicKeyArmored?: string,
): Promise<DecryptedMessage | null> {
  const cacheKey = decryptCacheKey(msg.id, senderPublicKeyArmored);
  const cached = decryptedCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const { privateKey, publicKey } = useKeyringStore.getState();
  const result = await tryDecrypt(msg, { privateKey, publicKey }, senderPublicKeyArmored);

  if (result !== null) {
    decryptedCache.set(cacheKey, result);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Pagination shape
 * ------------------------------------------------------------------ */

const PAGE_LIMIT = 50;

/** A single page returned by the messages API. */
type MessagesPage = ListItems<DialogMessage>;

/** `useInfiniteQuery`'s `select` output: all loaded pages flattened + reversed. */
interface FlatMessages {
  pages: MessagesPage[];
  items: DialogMessage[];
}

/** Distinguishes the two list flavors; used as the second slot of the query key. */
export type MessagesKind = "private" | "group";

/* ------------------------------------------------------------------ *
 * usePrivateMessages
 * ------------------------------------------------------------------ */

export function usePrivateMessages(
  chatId: string | undefined,
): UseInfiniteQueryResult<FlatMessages, Error> {
  const ownerId = useSessionStore((s) => s.user?.id);
  const query = useInfiniteQuery<
    MessagesPage,
    Error,
    FlatMessages,
    readonly ["messages", "private", string],
    number
  >({
    queryKey: ["messages", "private", chatId ?? ""],
    enabled: chatId !== undefined,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      messagesApi.getPrivateMessages(chatId!, {
        offset: pageParam,
        limit: PAGE_LIMIT,
      }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length === PAGE_LIMIT ? allPages.flatMap((p) => p.items).length : undefined,
    select: (data) => ({
      pages: data.pages,
      // Server returns oldest-first; reverse so the UI can render
      // newest at the bottom (typical chat layout).
      items: data.pages.flatMap((p) => p.items).reverse(),
    }),
  });

  // Сохраняем каждую загрузку страниц в шифрованный локальный стор.
  // Через ref отслеживаем id самого нового сообщения, чтобы не
  // перезаписывать файл зря при изменении зависимостей useEffect.
  const lastSeenIdRef = useRef<string | null>(null);
  useEffect(() => {
    const data = query.data;
    if (chatId === undefined || ownerId === undefined || data === undefined) return;
    const items = data.pages.flatMap((p) => p.items);
    if (items.length === 0) return;
    const head = items[items.length - 1];
    if (head === undefined || head.id === lastSeenIdRef.current) return;
    lastSeenIdRef.current = head.id;
    void appendManyDialog(ownerId, chatId, items).catch((e) => {
      void debugLog("dialog-store append from list", e, { chatId, count: items.length });
    });
  }, [chatId, ownerId, query.data]);

  return query;
}

/* ------------------------------------------------------------------ *
 * useGroupMessages
 * ------------------------------------------------------------------ */

export function useGroupMessages(
  chatId: string | undefined,
): UseInfiniteQueryResult<FlatMessages, Error> {
  const ownerId = useSessionStore((s) => s.user?.id);
  const query = useInfiniteQuery<
    MessagesPage,
    Error,
    FlatMessages,
    readonly ["messages", "group", string],
    number
  >({
    queryKey: ["messages", "group", chatId ?? ""],
    enabled: chatId !== undefined,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      messagesApi.getGroupMessages(chatId!, {
        offset: pageParam,
        limit: PAGE_LIMIT,
      }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length === PAGE_LIMIT ? allPages.flatMap((p) => p.items).length : undefined,
    select: (data) => ({
      pages: data.pages,
      items: data.pages.flatMap((p) => p.items).reverse(),
    }),
  });

  const lastSeenIdRef = useRef<string | null>(null);
  useEffect(() => {
    const data = query.data;
    if (chatId === undefined || ownerId === undefined || data === undefined) return;
    const items = data.pages.flatMap((p) => p.items);
    if (items.length === 0) return;
    const head = items[items.length - 1];
    if (head === undefined || head.id === lastSeenIdRef.current) return;
    lastSeenIdRef.current = head.id;
    void appendManyDialog(ownerId, chatId, items).catch((e) => {
      void debugLog("dialog-store append from group list", e, {
        chatId,
        count: items.length,
      });
    });
  }, [chatId, ownerId, query.data]);

  return query;
}

/* ------------------------------------------------------------------ *
 * useDecryptedMessage — per-message lazy decryption
 * ------------------------------------------------------------------ */

/**
 * Lazily decrypt a single message. Backed by React Query so React
 * StrictMode double-invokes and concurrent renders don't run the
 * OpenPGP work twice.
 *
 * `enabled` is gated on `keyringStore.privateKey !== null` AND a
 * non-empty `encryptedMessage` — while locked, or for pending/failed
 * optimistic messages that haven't been encrypted yet, the query
 * stays idle and `data` stays `undefined`, so the UI should render a
 * "🔒 Locked" placeholder.
 *
 * `staleTime: Infinity` because the plaintext of a given `messageId`
 * never changes; React Query won't refetch on remount.
 *
 * The query key includes the sender-key armor: the sender lookup often
 * resolves AFTER the first decrypt attempt (which then verifies against
 * the fallback own key and caches `verified: false` forever under
 * `staleTime: Infinity`). When the real sender key lands, the key
 * changes and the message is re-decrypted + re-verified properly.
 */
export function useDecryptedMessage(
  messageId: string,
  encryptedMessage: string,
  signature: string,
  senderPublicKeyArmored?: string,
): UseQueryResult<DecryptedMessage | null, Error> {
  const privateKey = useKeyringStore((s) => s.privateKey);

  return useQuery<DecryptedMessage | null, Error>({
    queryKey: ["message-decrypt", messageId, senderPublicKeyArmored ?? ""],
    enabled: privateKey !== null && encryptedMessage.length > 0,
    staleTime: Infinity,
    queryFn: async (): Promise<DecryptedMessage | null> => {
      // Build a minimal stub so we can reuse `decryptMessage`. Only the
      // three fields touched by the helper matter; the rest is filler.
      const stub = {
        id: messageId,
        encrypted_message: encryptedMessage,
        signature,
      } as unknown as DialogMessage;
      return decryptMessage(stub, senderPublicKeyArmored);
    },
  });
}

/* ------------------------------------------------------------------ *
 * Cache invalidation helpers
 * ------------------------------------------------------------------ */

/**
 * Imperatively invalidate the cached pages for a single chat. Useful
 * when an external system (a fresh event poll, a manual refresh) knows
 * new messages exist and we don't want to wait for stale-time. Exposed
 * here so the query-key shape lives in exactly one place and stays in
 * sync with the hooks above.
 */
export function useInvalidateMessages(): (chatId: string, kind?: MessagesKind) => Promise<void> {
  const queryClient = useQueryClient();
  return async (chatId: string, kind: MessagesKind = "private") => {
    await queryClient.invalidateQueries({
      queryKey: ["messages", kind, chatId],
    });
  };
}

/**
 * Lower-level helper for callers that already hold a `QueryClient`
 * (e.g. `QueryClient` defaults, middleware, or tests).
 */
export function invalidateMessages(
  queryClient: QueryClient,
  chatId: string,
  kind: MessagesKind = "private",
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: ["messages", kind, chatId],
  });
}
