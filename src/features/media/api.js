import { apiClient } from "@/infra/apiClient";
/**
 * Upload an encrypted media attachment to a private chat.
 *
 * Backend route: `POST /messages/private-message/{chat_id}/media/upload`
 * (mounts the `/private-message`-prefixed router under `/messages`).
 *
 * Returns `201` with the attachment metadata (without the blob).
 *
 * @param chatId - UUID of the dialog chat.
 * @param req - Encrypted file + detached signature (both base64), plus
 *   plaintext metadata (`mime_type`, `file_size`). The server enforces
 *   `file_size <= MAX_MEDIA_SIZE_BYTES` (default 50 MB) and verifies the
 *   signature against the user's stored public key.
 * @param options - `signal` aborts the request; `onProgress` is reserved.
 */
export async function uploadPrivateMedia(chatId, req, options) {
    return apiClient.post(`/messages/private-message/${chatId}/media/upload`, req, options?.signal ? { signal: options.signal } : undefined);
}
/**
 * Upload an encrypted media attachment to a group chat.
 *
 * Backend route: `POST /group-messages/group-message/{chat_id}/media/upload`.
 *
 * Same base64 convention as {@link uploadPrivateMedia}.
 */
export async function uploadGroupMedia(chatId, req, options) {
    return apiClient.post(`/group-messages/group-message/${chatId}/media/upload`, req, options?.signal ? { signal: options.signal } : undefined);
}
/**
 * List media attachments for a private message.
 *
 * Backend route: `GET /messages/private-message/{message_id}/media/`.
 */
export async function listPrivateMedia(messageId) {
    return apiClient.get(`/messages/private-message/${messageId}/media/`);
}
/**
 * List media attachments for a group message.
 *
 * Backend route: `GET /group-messages/group-message/{message_id}/media/`.
 */
export async function listGroupMedia(messageId) {
    return apiClient.get(`/group-messages/group-message/${messageId}/media/`);
}
/**
 * Download an encrypted media attachment from a private chat.
 *
 * Backend route: `GET /messages/private-message/media/{media_id}`.
 *
 * `encrypted_file` and `signature` in the response are base64 strings; the
 * decryption pipeline (TASK-072) is responsible for decoding them before
 * passing them to openpgp.js.
 */
export async function downloadPrivateMedia(mediaId) {
    return apiClient.get(`/messages/private-message/media/${mediaId}`);
}
/**
 * Download an encrypted media attachment from a group chat.
 *
 * Backend route: `GET /group-messages/group-message/media/{media_id}`.
 *
 * Same base64 convention as {@link downloadPrivateMedia}.
 */
export async function downloadGroupMedia(mediaId) {
    return apiClient.get(`/group-messages/group-message/media/${mediaId}`);
}
/**
 * Delete a media attachment from a private chat (owner-only).
 *
 * Backend route: `DELETE /messages/private-message/media/{media_id}/`.
 *
 * If the attachment is already linked to a message, only the link is
 * cleared on the server side; the message itself is preserved.
 */
export async function deletePrivateMedia(mediaId) {
    return apiClient.delete(`/messages/private-message/media/${mediaId}/`);
}
/**
 * Delete a media attachment from a group chat (owner-only).
 *
 * Backend route: `DELETE /group-messages/group-message/media/{media_id}/`.
 */
export async function deleteGroupMedia(mediaId) {
    return apiClient.delete(`/group-messages/group-message/media/${mediaId}/`);
}
