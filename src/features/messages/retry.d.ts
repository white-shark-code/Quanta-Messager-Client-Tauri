/**
 * Retry mutation for failed messages (TASK-055).
 *
 * Lives next to `mutations.ts` (TASK-052) but exposes a different shape:
 *   - `mutations.ts` exports `useRetryMessage(chatId, kind)` that reads the
 *     failed row's plaintext back from the optimistic cache and forwards
 *     it into the same `useSendMessage` mutation. Useful when the UI just
 *     has the temp id and trusts the cache to hold the plaintext.
 *   - This module exposes `useRetryMessage()` (no args) that returns a
 *     vanilla `useMutation` whose `mutationFn` takes the full
 *     {@link RetryInput} (kind/chatId/text) explicitly. Useful when the
 *     caller already holds the plaintext — composer draft restored from
 *     local storage, retry queue replay, programmatic bulk retry, tests.
 *
 * Both share the same encryption pipeline (`keyring.encryptText` +
 * `bytesToBase64`) and the same wire types, so a retried message is
 * byte-identical to a first-attempt message. The cache contract is also
 * shared: `["messages", kind, chatId]` as `MessagesCache`.
 *
 * Flow:
 *   1. `onMutate` drops the failed optimistic row from the cache so the UI
 *      doesn't briefly show the message twice (once as `failed`, once as
 *      the fresh `pending` row that `useSendMessage` would insert if it
 *      were reused).
 *   2. `mutationFn` re-encrypts + re-sends via the same
 *      `messagesApi.send*Message` transport as TASK-052.
 *   3. `onSuccess` invalidates the chat's message list so the freshly
 *      delivered server row shows up on the next render.
 *   4. `onError` only logs — the failed row is already gone, and per
 *      TASK-055 spec we don't try to re-add it (a follow-up could decide
 *      to re-insert as `failed` if product UX wants the retry affordance
 *      to survive transient network blips).
 */
import { type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import { type ChatKind } from "./mutations";
/**
 * Full input for one retry attempt.
 *
 * The caller is responsible for deciding **when** to retry; this hook only
 * cares about **what** to send and **which** failed row to clear from the
 * cache first.
 */
export interface RetryInput {
    /** Chat namespace — picks `sendPrivateMessage` vs `sendGroupMessage`. */
    kind: ChatKind;
    /** UUID of the dialog / group chat to send into. */
    chatId: string;
    /**
     * Temp id (`optimistic-<uuid>`) of the failed row to drop from the
     * cache. No-op if the row is already gone (e.g. cache was invalidated
     * by an events poll in between).
     */
    messageId: string;
    /**
     * Plaintext to re-encrypt and send. The caller already has it — UI
     * hydrates it from the composer draft, tests build it inline, etc.
     * Empty strings are rejected by the underlying send mutation.
     */
    text: string;
}
/**
 * Slim success envelope.
 *
 * Only the server-assigned `id` is useful to the UI (e.g. for scrolling
 * to the delivered row). The rest of the `DialogMessage` lands via the
 * `onSuccess`-triggered refetch.
 */
export interface RetryResult {
    id: string;
}
/**
 * Drop a failed optimistic row from the messages cache.
 *
 * Pure cache mutation — no network, no React subscriptions. Exported so
 * non-React callers (tests, a future imperative API) can do the same
 * cleanup without going through the mutation lifecycle.
 *
 * Walks every page rather than assuming the row lives on page 0; the
 * newest-first invariant from `mutations.ts` puts it there in practice,
 * but `removeFailedFromCache` is a generic helper and shouldn't bake that
 * assumption in.
 *
 * No-op when the cache slot is empty (`undefined` is returned as-is) — the
 * chat may never have been opened, or an events poll may have already
 * invalidated it.
 */
export declare function removeFailedFromCache(client: QueryClient, kind: ChatKind, chatId: string, messageId: string): void;
/**
 * Retry mutation hook (TASK-055).
 *
 * Selectors rather than whole-store subscriptions so a fingerprint /
 * status update in the keyring doesn't re-trigger the mutation closure.
 * Type narrowing (`privateKey !== null`) survives the closure because the
 * hook reads them into `const` locals once per call.
 */
export declare function useRetryMessage(): UseMutationResult<RetryResult, Error, RetryInput, void>;
