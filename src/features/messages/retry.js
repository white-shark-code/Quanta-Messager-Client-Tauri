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
import { useMutation, useQueryClient, } from "@tanstack/react-query";
import { useSessionStore } from "@/features/auth/sessionStore";
import * as keyring from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { toUserMessage } from "@/infra/error";
import * as messagesApi from "./api";
import { bytesToBase64, messagesQueryKey, } from "./mutations";
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
export function removeFailedFromCache(client, kind, chatId, messageId) {
    const key = messagesQueryKey(kind, chatId);
    client.setQueryData(key, (old) => {
        if (old === undefined) {
            return old;
        }
        return {
            ...old,
            pages: old.pages.map((page) => ({
                ...page,
                items: page.items.filter((item) => item.id !== messageId),
            })),
        };
    });
}
/**
 * Retry mutation hook (TASK-055).
 *
 * Selectors rather than whole-store subscriptions so a fingerprint /
 * status update in the keyring doesn't re-trigger the mutation closure.
 * Type narrowing (`privateKey !== null`) survives the closure because the
 * hook reads them into `const` locals once per call.
 */
export function useRetryMessage() {
    const queryClient = useQueryClient();
    const privateKey = useKeyringStore((s) => s.privateKey);
    const publicKey = useKeyringStore((s) => s.publicKey);
    const user = useSessionStore((s) => s.user);
    return useMutation({
        mutationKey: ["messages", "retry"],
        mutationFn: async ({ kind, chatId, text }) => {
            if (privateKey === null || publicKey === null) {
                throw new Error("Keys not loaded");
            }
            if (user === null) {
                throw new Error("Not logged in");
            }
            // This variant has no peer key by design (notes-to-self /
            // programmatic use), so both slots carry the self-encrypted
            // pair: the backend requires both, and both stay decryptable
            // by the sender.
            const { encrypted, signature } = await keyring.encryptText(text, [publicKey], privateKey);
            const send = kind === "private"
                ? messagesApi.sendPrivateMessage
                : messagesApi.sendGroupMessage;
            const server = await send(chatId, {
                encrypted_message: bytesToBase64(encrypted),
                signature: bytesToBase64(signature),
                encrypted_message_self: bytesToBase64(encrypted),
                signature_self: bytesToBase64(signature),
            });
            return { id: server.id };
        },
        onMutate: ({ kind, chatId, messageId }) => {
            removeFailedFromCache(queryClient, kind, chatId, messageId);
        },
        onSuccess: (_result, { kind, chatId }) => {
            void queryClient.invalidateQueries({ queryKey: messagesQueryKey(kind, chatId) });
        },
        onError: (err) => {
            console.error("retry message failed:", toUserMessage(err));
        },
    });
}
