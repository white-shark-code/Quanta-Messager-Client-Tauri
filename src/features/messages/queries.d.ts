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
 * MVP caveat (see `.agents/report_for_backend/01`): there is no
 * per-message sender-public-key lookup yet, so verification falls back
 * to the current user's own public key. That is correct for self-
 * messages (notes-to-self) and will mis-verify for real correspondents
 * until the backend exposes the missing endpoint. Decryption itself
 * still works in both cases because the recipient is always the
 * current user.
 */
import { type QueryClient, type UseInfiniteQueryResult, type UseQueryResult } from "@tanstack/react-query";
import type { DialogMessage, ListItems } from "./model";
/** A decrypted message — plaintext + signature-verification result. */
export interface DecryptedMessage {
    text: string;
    verified: boolean;
}
/**
 * Wipe the entire decryption cache. Call on lock / logout — once the
 * private key is gone, the cached plaintexts are the only remaining
 * copy of the cleartext message, and they must not survive a lock
 * boundary.
 */
export declare function clearDecryptedCache(): void;
/**
 * Manual read-access to the decryption cache. Returns `undefined` if
 * the message hasn't been decrypted yet (either because it hasn't
 * rendered or because decryption hasn't completed). Lets non-React
 * code (logging, tests) peek without subscribing to a query.
 */
export declare function getDecrypted(id: string): DecryptedMessage | undefined;
/** A single page returned by the messages API. */
type MessagesPage = ListItems<DialogMessage>;
/** `useInfiniteQuery`'s `select` output: all loaded pages flattened + reversed. */
interface FlatMessages {
    pages: MessagesPage[];
    items: DialogMessage[];
}
/** Distinguishes the two list flavors; used as the second slot of the query key. */
export type MessagesKind = "private" | "group";
export declare function usePrivateMessages(chatId: string | undefined): UseInfiniteQueryResult<FlatMessages, Error>;
export declare function useGroupMessages(chatId: string | undefined): UseInfiniteQueryResult<FlatMessages, Error>;
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
 */
export declare function useDecryptedMessage(messageId: string, encryptedMessage: string, signature: string, senderPublicKeyArmored?: string): UseQueryResult<DecryptedMessage | null, Error>;
/**
 * Imperatively invalidate the cached pages for a single chat. Useful
 * when an external system (a fresh event poll, a manual refresh) knows
 * new messages exist and we don't want to wait for stale-time. Exposed
 * here so the query-key shape lives in exactly one place and stays in
 * sync with the hooks above.
 */
export declare function useInvalidateMessages(): (chatId: string, kind?: MessagesKind) => Promise<void>;
/**
 * Lower-level helper for callers that already hold a `QueryClient`
 * (e.g. `QueryClient` defaults, middleware, or tests).
 */
export declare function invalidateMessages(queryClient: QueryClient, chatId: string, kind?: MessagesKind): Promise<void>;
export {};
