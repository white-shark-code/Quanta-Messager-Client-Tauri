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
import { useMutation, useQueryClient, } from "@tanstack/react-query";
import { useSessionStore } from "@/features/auth/sessionStore";
import * as keyring from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { toUserMessage } from "@/infra/error";
import { debugLog } from "@/lib/debug";
import * as messagesApi from "./api";
const BASE64_CHUNK = 0x8000;
/**
 * `Uint8Array → base64`.
 *
 * Chunked because `String.fromCharCode(...bytes)` blows the argument
 * limit on large PGP blobs. Mirrors `infra/apiClient`'s internal encoder;
 * we encode here (rather than leaning on the client's JSON replacer) so
 * {@link CreateMessageRequest} keeps its documented `string` fields.
 */
export function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
    }
    return btoa(binary);
}
export function messagesQueryKey(kind, chatId) {
    return ["messages", kind, chatId];
}
export function isPendingMessage(msg) {
    return msg.optimistic === true;
}
function newTempId() {
    return `optimistic-${crypto.randomUUID()}`;
}
function makePending(chatId, ownerId, text, status = "pending") {
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
function insertPending(cache, pending) {
    const [first, ...rest] = cache.pages;
    if (first === undefined) {
        return { pages: [{ items: [pending] }], pageParams: [...cache.pageParams] };
    }
    return {
        ...cache,
        pages: [{ ...first, items: [pending, ...first.items] }, ...rest],
    };
}
function mapPages(cache, fn) {
    return { ...cache, pages: cache.pages.map((page) => ({ ...page, items: fn(page.items) })) };
}
function replacePending(cache, tempId, server) {
    return mapPages(cache, (items) => items.map((item) => (item.id === tempId ? server : item)));
}
function dropMessage(cache, id) {
    return mapPages(cache, (items) => items.filter((item) => item.id !== id));
}
function updateCache(queryClient, key, fn) {
    queryClient.setQueryData(key, (cache) => cache === undefined ? cache : fn(cache));
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
async function resolveRecipients(ownPublicKey, peerPublicKeyArmored, expectPeer) {
    if (peerPublicKeyArmored !== null && peerPublicKeyArmored.length > 0) {
        const peerKey = await keyring.importPublicKey(peerPublicKeyArmored);
        return [peerKey];
    }
    if (expectPeer) {
        throw new Error("resolveRecipients: peer public key missing for peer chat — refusing to encrypt-to-self. Wait for peerKey to load and retry.");
    }
    if (ownPublicKey !== null)
        return [ownPublicKey];
    return null;
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
function useSendMessage(kind, chatId, send, peerPublicKeyArmored) {
    const queryClient = useQueryClient();
    const publicKey = useKeyringStore((s) => s.publicKey);
    const privateKey = useKeyringStore((s) => s.privateKey);
    const user = useSessionStore((s) => s.user);
    const queryKey = messagesQueryKey(kind, chatId);
    return useMutation({
        mutationKey: ["messages", kind, chatId, "send"],
        mutationFn: async ({ text }) => {
            if (privateKey === null) {
                throw new Error("Keys not loaded");
            }
            if (user === null) {
                throw new Error("Not logged in");
            }
            if (text.trim().length === 0) {
                throw new Error("Cannot send an empty message");
            }
            const recipients = await resolveRecipients(publicKey, peerPublicKeyArmored ?? null, kind === "private");
            if (recipients === null) {
                throw new Error("No recipient public key available");
            }
            // Log which mode we ended up using — invaluable when debugging
            // "Bob encrypted to himself and Alice sees Заблокировано".
            const peerArmored = peerPublicKeyArmored ?? null;
            const mode = peerArmored !== null && peerArmored.length > 0
                ? "peer-encryption"
                : publicKey !== null
                    ? "encrypt-to-self"
                    : "none";
            console.log(`[send ${kind}] mode=${mode} peerArmoredLen=${peerArmored?.length ?? 0}`);
            const { encrypted, signature } = await keyring.encryptText(text, recipients, privateKey);
            return send(chatId, {
                encrypted_message: bytesToBase64(encrypted),
                signature: bytesToBase64(signature),
            });
        },
        onMutate: async ({ text }) => {
            // A refetch landing mid-flight would clobber the optimistic row.
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData(queryKey);
            const pending = makePending(chatId, user?.id ?? "me", text);
            if (previous !== undefined) {
                queryClient.setQueryData(queryKey, insertPending(previous, pending));
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
            queryClient.setQueryData(queryKey, context.previous);
            // …then re-add the row as `failed` so the retry affordance survives
            // the rollback (design.md §9.4).
            updateCache(queryClient, queryKey, (cache) => insertPending(cache, { ...context.pending, status: "failed" }));
            console.error(`send ${kind} message failed:`, toUserMessage(err));
        },
        onSuccess: (server, _vars, context) => {
            updateCache(queryClient, queryKey, (cache) => replacePending(cache, context.pending.id, server));
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
export function useSendPrivateMessage(chatId, peerPublicKeyArmored) {
    return useSendMessage("private", chatId, messagesApi.sendPrivateMessage, peerPublicKeyArmored);
}
export function useSendGroupMessage(chatId, peerPublicKeyArmored) {
    return useSendMessage("group", chatId, messagesApi.sendGroupMessage, peerPublicKeyArmored);
}
/**
 * Retry helper for failed sends.
 *
 * The plaintext is read back from the optimistic row in the cache rather
 * than from `composerStore` — the draft is cleared as soon as the message
 * is handed off, so the cache is the only place that still knows what the
 * user typed.
 */
export function useRetryMessage(chatId, kind = "private") {
    const queryClient = useQueryClient();
    // `useSendMessage` is called unconditionally — only its transport
    // argument depends on `kind`, so hook order stays stable across renders.
    const mutation = useSendMessage(kind, chatId, kind === "group" ? messagesApi.sendGroupMessage : messagesApi.sendPrivateMessage, null);
    const queryKey = messagesQueryKey(kind, chatId);
    const retry = (messageId) => {
        const cache = queryClient.getQueryData(queryKey);
        const failed = cache?.pages
            .flatMap((page) => page.items)
            .find((item) => item.id === messageId && isPendingMessage(item));
        if (failed?.status !== "failed") {
            return;
        }
        updateCache(queryClient, queryKey, (current) => dropMessage(current, messageId));
        mutation.mutate({ chatId, text: failed.text });
    };
    return {
        retry,
        isRetrying: mutation.isPending,
        canRetry: (message) => isPendingMessage(message) && message.status === "failed",
    };
}
