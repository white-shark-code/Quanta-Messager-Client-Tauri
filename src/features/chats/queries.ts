import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import * as chatsApi from "./api";
import { toUserMessage } from "@/infra/error";

export function usePrivateChats() {
  return useQuery({
    queryKey: ["chats", "private"],
    queryFn: () => chatsApi.getAllPrivateChats().then((r) => r.items),
    staleTime: 30_000,
  });
}

export function useCreatePrivateChat() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: chatsApi.createPrivateChat,
    onSuccess: (chat) => {
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      navigate(`/chats/${chat.id}`);
    },
    onError: (err) => {
      console.error("createPrivateChat failed:", toUserMessage(err));
    },
  });
}

export function useDeletePrivateChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: chatsApi.deletePrivateChat,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
    onError: (err) => {
      console.error("deletePrivateChat failed:", toUserMessage(err));
    },
  });
}

export function useCreateGroupChat() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: chatsApi.createGroupChat,
    onSuccess: (chat) => {
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
      navigate(`/chats/${chat.id}`);
    },
    onError: (err) => {
      console.error("createGroupChat failed:", toUserMessage(err));
    },
  });
}

export function usePrivateChat(chatId: string | undefined) {
  return useQuery({
    queryKey: ["chats", "private", chatId],
    queryFn: () => chatsApi.getPrivateChat(chatId!),
    enabled: !!chatId,
    staleTime: 60_000,
  });
}