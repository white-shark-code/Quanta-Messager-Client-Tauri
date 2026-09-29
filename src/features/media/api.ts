import { apiClient } from "@/infra/apiClient";

import type { ListItems, MediaAttachment, MediaDownload, UploadMediaRequest } from "./model";

/**
 * Options for media upload.
 *
 * `onProgress` is **not implemented** in the MVP. The apiClient is built on
 * `fetch`, which has no upload-progress events. To report real progress we
 * would need to either:
 *   1. drop down to `XMLHttpRequest.upload.onprogress`, or
 *   2. use the Tauri `http` plugin (which exposes a streaming API).
 *
 * Both are deferred to TASK-074. For now, callers should show an
 * indeterminate spinner while `uploadPrivateMedia` / `uploadGroupMedia`
 * are in flight.
 *
 * `signal` is forwarded to the apiClient and aborts the underlying fetch
 * when triggered.
 */
export interface UploadMediaOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

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
export async function uploadPrivateMedia(
  chatId: string,
  req: UploadMediaRequest,
  options?: UploadMediaOptions,
): Promise<MediaAttachment> {
  return apiClient.post<MediaAttachment>(
    `/messages/private-message/${chatId}/media/upload`,
    req,
    options?.signal ? { signal: options.signal } : undefined,
  );
}

/**
 * Upload an encrypted media attachment to a group chat.
 *
 * Backend route: `POST /group-messages/group-message/{chat_id}/media/upload`.
 *
 * Same base64 convention as {@link uploadPrivateMedia}.
 */
export async function uploadGroupMedia(
  chatId: string,
  req: UploadMediaRequest,
  options?: UploadMediaOptions,
): Promise<MediaAttachment> {
  return apiClient.post<MediaAttachment>(
    `/group-messages/group-message/${chatId}/media/upload`,
    req,
    options?.signal ? { signal: options.signal } : undefined,
  );
}

/**
 * List media attachments for a private message.
 *
 * Backend route: `GET /messages/private-message/{message_id}/media/`.
 */
export async function listPrivateMedia(messageId: string): Promise<ListItems<MediaAttachment>> {
  return apiClient.get<ListItems<MediaAttachment>>(`/messages/private-message/${messageId}/media/`);
}

/**
 * List media attachments for a group message.
 *
 * Backend route: `GET /group-messages/group-message/{message_id}/media/`.
 */
export async function listGroupMedia(messageId: string): Promise<ListItems<MediaAttachment>> {
  return apiClient.get<ListItems<MediaAttachment>>(
    `/group-messages/group-message/${messageId}/media/`,
  );
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
export async function downloadPrivateMedia(mediaId: string): Promise<MediaDownload> {
  return apiClient.get<MediaDownload>(`/messages/private-message/media/${mediaId}`);
}

/**
 * Download an encrypted media attachment from a group chat.
 *
 * Backend route: `GET /group-messages/group-message/media/{media_id}`.
 *
 * Same base64 convention as {@link downloadPrivateMedia}.
 */
export async function downloadGroupMedia(mediaId: string): Promise<MediaDownload> {
  return apiClient.get<MediaDownload>(`/group-messages/group-message/media/${mediaId}`);
}

/**
 * Delete a media attachment from a private chat (owner-only).
 *
 * Backend route: `DELETE /messages/private-message/media/{media_id}/`.
 *
 * If the attachment is already linked to a message, only the link is
 * cleared on the server side; the message itself is preserved.
 */
export async function deletePrivateMedia(mediaId: string): Promise<MediaAttachment> {
  return apiClient.delete<MediaAttachment>(`/messages/private-message/media/${mediaId}/`);
}

/**
 * Delete a media attachment from a group chat (owner-only).
 *
 * Backend route: `DELETE /group-messages/group-message/media/{media_id}/`.
 */
export async function deleteGroupMedia(mediaId: string): Promise<MediaAttachment> {
  return apiClient.delete<MediaAttachment>(`/group-messages/group-message/media/${mediaId}/`);
}
