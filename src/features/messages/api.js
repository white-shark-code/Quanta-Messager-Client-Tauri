import { apiClient } from "@/infra/apiClient";
function withQuery(path, params) {
    if (!params)
        return path;
    const search = new URLSearchParams();
    if (params.offset !== undefined)
        search.set("offset", String(params.offset));
    if (params.limit !== undefined)
        search.set("limit", String(params.limit));
    const qs = search.toString();
    return qs.length === 0 ? path : `${path}?${qs}`;
}
/**
 * Fetch messages from a private dialog chat.
 *
 * Backend route: `GET /messages/private-messages/{chat_id}`
 * (mounts the `/private-message`-prefixed router under `/messages`).
 *
 * @param chatId - UUID of the dialog chat.
 * @param params - Optional `offset`/`limit` pagination.
 */
export async function getPrivateMessages(chatId, params) {
    return apiClient.get(withQuery(`/messages/private-messages/${chatId}`, params));
}
/**
 * Send an encrypted message to a private dialog chat.
 *
 * Backend route: `POST /messages/private-message/{chat_id}`.
 *
 * `req.encrypted_message` and `req.signature` must be base64 strings; the
 * apiClient reviver will accept them as-is (binary form is not applicable
 * to JSON bodies — pass strings here).
 */
export async function sendPrivateMessage(chatId, req) {
    return apiClient.post(`/messages/private-message/${chatId}`, req);
}
/**
 * Fetch messages from a group chat.
 *
 * Backend route: `GET /group-messages/group-message/{chat_id}`
 * (mounts the `/group-message`-prefixed router under `/group-messages`).
 *
 * @param chatId - UUID of the group chat.
 * @param params - Optional `offset`/`limit` pagination.
 */
export async function getGroupMessages(chatId, params) {
    return apiClient.get(withQuery(`/group-messages/group-message/${chatId}`, params));
}
/**
 * Send an encrypted message to a group chat.
 *
 * Backend route: `POST /group-messages/group-message/{chat_id}`.
 *
 * Same base64 convention as {@link sendPrivateMessage}.
 */
export async function sendGroupMessage(chatId, req) {
    return apiClient.post(`/group-messages/group-message/${chatId}`, req);
}
