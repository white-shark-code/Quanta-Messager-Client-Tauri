import { apiClient } from "@/infra/apiClient";
const DEFAULT_PAGE_SIZE = 50;
/** Build query string from GetChatsParams. Returns "" when no params. */
function buildChatsQuery(params) {
    const search = new URLSearchParams();
    if (params.last_id !== undefined) {
        search.append("last_id", params.last_id);
    }
    search.append("page_size", String(params.page_size ?? DEFAULT_PAGE_SIZE));
    return `?${search.toString()}`;
}
export async function getAllPrivateChats(params = {}) {
    return apiClient.get(`/messages/private-chats/${buildChatsQuery(params)}`);
}
export async function getPrivateChat(chatId) {
    return apiClient.get(`/messages/private-chat/${chatId}`);
}
export async function createPrivateChat(req) {
    return apiClient.post("/messages/private-chat/", req);
}
export async function deletePrivateChat(chatId) {
    return apiClient.delete(`/messages/private-chat/${chatId}/`);
}
/**
 * New endpoint: GET /group-messages/group-chats/
 * Returns group chats the current user is a member of (cursor-paginated).
 */
export async function getAllGroupChats(params = {}) {
    return apiClient.get(`/group-messages/group-chats/${buildChatsQuery(params)}`);
}
/**
 * Create a new group chat.
 * Backend requires `public_key: bytes` (PGP armored public key).
 * For MVP, the creator's own public key is used (per design.md §10 +
 * report_for_backend/02 — true group E2E not implemented yet).
 */
export async function createGroupChat(req) {
    return apiClient.post("/group-messages/group-chat/", req);
}
/** Type guard for distinguishing dialog vs group chats by response shape. */
export function isGroupChat(chat) {
    return "public_key" in chat;
}
