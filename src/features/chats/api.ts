import { apiClient } from "@/infra/apiClient";

import type {
  AnyChat,
  CreatePrivateChatRequest,
  CreateGroupChatRequest,
  DialogChat,
  GroupChat,
  PaginatedResponse,
} from "./model";

/**
 * Query params for cursor-paginated chat list endpoints.
 * Backend expects `?last_id=<uuid>&page_size=<int>` (matches
 * `AbstractUUIDPagginationBaseModel`).
 */
export interface GetChatsParams {
  last_id?: string;
  page_size?: number;
}

const DEFAULT_PAGE_SIZE = 50;

/** Build query string from GetChatsParams. Returns "" when no params. */
function buildChatsQuery(params: GetChatsParams): string {
  const search = new URLSearchParams();
  if (params.last_id !== undefined) {
    search.append("last_id", params.last_id);
  }
  search.append("page_size", String(params.page_size ?? DEFAULT_PAGE_SIZE));
  return `?${search.toString()}`;
}

export async function getAllPrivateChats(
  params: GetChatsParams = {},
): Promise<PaginatedResponse<DialogChat>> {
  return apiClient.get<PaginatedResponse<DialogChat>>(
    `/messages/private-chats/${buildChatsQuery(params)}`,
  );
}

export async function getPrivateChat(chatId: string): Promise<DialogChat> {
  return apiClient.get<DialogChat>(`/messages/private-chat/${chatId}`);
}

export async function createPrivateChat(req: CreatePrivateChatRequest): Promise<DialogChat> {
  return apiClient.post<DialogChat>("/messages/private-chat/", req);
}

export async function deletePrivateChat(chatId: string): Promise<DialogChat> {
  return apiClient.delete<DialogChat>(`/messages/private-chat/${chatId}/`);
}

/**
 * New endpoint: GET /group-messages/group-chats/
 * Returns group chats the current user is a member of (cursor-paginated).
 */
export async function getAllGroupChats(
  params: GetChatsParams = {},
): Promise<PaginatedResponse<GroupChat>> {
  return apiClient.get<PaginatedResponse<GroupChat>>(
    `/group-messages/group-chats/${buildChatsQuery(params)}`,
  );
}

/**
 * Create a new group chat.
 * Backend requires `public_key: bytes` (PGP armored public key).
 * For MVP, the creator's own public key is used (per design.md §10 +
 * report_for_backend/02 — true group E2E not implemented yet).
 */
export async function createGroupChat(req: CreateGroupChatRequest): Promise<GroupChat> {
  return apiClient.post<GroupChat>("/group-messages/group-chat/", req);
}

/** Type guard for distinguishing dialog vs group chats by response shape. */
export function isGroupChat(chat: AnyChat): chat is GroupChat {
  return "public_key" in chat;
}
