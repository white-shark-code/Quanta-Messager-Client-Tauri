import { apiClient } from "@/infra/apiClient";

import type {
  AnyChat,
  CreateChatRequest,
  DialogChat,
  GroupChat,
  ListItems,
} from "./model";

export async function getAllPrivateChats(): Promise<ListItems<DialogChat>> {
  return apiClient.get<ListItems<DialogChat>>("/messages/private-chats/");
}

export async function getPrivateChat(chatId: string): Promise<DialogChat> {
  return apiClient.get<DialogChat>(`/messages/private-chat/${chatId}`);
}

export async function createPrivateChat(
  req: CreateChatRequest,
): Promise<DialogChat> {
  return apiClient.post<DialogChat>("/messages/private-chat/", req);
}

export async function deletePrivateChat(chatId: string): Promise<DialogChat> {
  return apiClient.delete<DialogChat>(`/messages/private-chat/${chatId}/`);
}

export async function createGroupChat(
  req: CreateChatRequest,
): Promise<GroupChat> {
  return apiClient.post<GroupChat>("/group-messages/group-chat/", req);
}

export function isGroupChat(chat: AnyChat): chat is GroupChat {
  return "public_key" in chat;
}
