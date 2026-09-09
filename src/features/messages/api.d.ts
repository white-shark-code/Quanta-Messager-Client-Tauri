import type { CreateMessageRequest, DialogMessage, ListItems } from "./model";
/**
 * Pagination params for message list endpoints.
 *
 * Note: the backend's FastAPI `Pagination` dependency expects `offset` and
 * `limit` as query parameters, not as a JSON body. Since {@link apiClient}
 * does not yet expose a typed `params` option, we manually serialize these
 * into the URL via {@link URLSearchParams}.
 */
export interface GetMessagesParams {
    offset?: number;
    limit?: number;
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
export declare function getPrivateMessages(chatId: string, params?: GetMessagesParams): Promise<ListItems<DialogMessage>>;
/**
 * Send an encrypted message to a private dialog chat.
 *
 * Backend route: `POST /messages/private-message/{chat_id}`.
 *
 * `req.encrypted_message` and `req.signature` must be base64 strings; the
 * apiClient reviver will accept them as-is (binary form is not applicable
 * to JSON bodies — pass strings here).
 */
export declare function sendPrivateMessage(chatId: string, req: CreateMessageRequest): Promise<DialogMessage>;
/**
 * Fetch messages from a group chat.
 *
 * Backend route: `GET /group-messages/group-message/{chat_id}`
 * (mounts the `/group-message`-prefixed router under `/group-messages`).
 *
 * @param chatId - UUID of the group chat.
 * @param params - Optional `offset`/`limit` pagination.
 */
export declare function getGroupMessages(chatId: string, params?: GetMessagesParams): Promise<ListItems<DialogMessage>>;
/**
 * Send an encrypted message to a group chat.
 *
 * Backend route: `POST /group-messages/group-message/{chat_id}`.
 *
 * Same base64 convention as {@link sendPrivateMessage}.
 */
export declare function sendGroupMessage(chatId: string, req: CreateMessageRequest): Promise<DialogMessage>;
