import type { AnyChat, CreatePrivateChatRequest, CreateGroupChatRequest, DialogChat, GroupChat, PaginatedResponse } from "./model";
/**
 * Query params for cursor-paginated chat list endpoints.
 * Backend expects `?last_id=<uuid>&page_size=<int>` (matches
 * `AbstractUUIDPagginationBaseModel`).
 */
export interface GetChatsParams {
    last_id?: string;
    page_size?: number;
}
export declare function getAllPrivateChats(params?: GetChatsParams): Promise<PaginatedResponse<DialogChat>>;
export declare function getPrivateChat(chatId: string): Promise<DialogChat>;
export declare function createPrivateChat(req: CreatePrivateChatRequest): Promise<DialogChat>;
export declare function deletePrivateChat(chatId: string): Promise<DialogChat>;
/**
 * New endpoint: GET /group-messages/group-chats/
 * Returns group chats the current user is a member of (cursor-paginated).
 */
export declare function getAllGroupChats(params?: GetChatsParams): Promise<PaginatedResponse<GroupChat>>;
/**
 * Create a new group chat.
 * Backend requires `public_key: bytes` (PGP armored public key).
 * For MVP, the creator's own public key is used (per design.md §10 +
 * report_for_backend/02 — true group E2E not implemented yet).
 */
export declare function createGroupChat(req: CreateGroupChatRequest): Promise<GroupChat>;
/** Type guard for distinguishing dialog vs group chats by response shape. */
export declare function isGroupChat(chat: AnyChat): chat is GroupChat;
