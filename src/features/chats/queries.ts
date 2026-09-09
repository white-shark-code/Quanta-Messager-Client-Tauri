import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import * as chatsApi from "./api";
import { toUserMessage } from "@/infra/error";
import { useKeyringStore } from "@/features/keyring/keyringStore";

const DEFAULT_PAGE_SIZE = 50;

/**
 * Cursor pagination helper.
 *
 * `last_id` from the previous page is passed as the next `pageParam`.
 * When `last_id` is null, there are no more pages.
 */
function lastIdOf<T>(page: { last_id: string | null } | undefined): string | null {
  return page?.last_id ?? null;
}

export function usePrivateChats() {
  return useInfiniteQuery({
    queryKey: ["chats", "private"],
    queryFn: ({ pageParam }) =>
      chatsApi
        .getAllPrivateChats({
          last_id: pageParam ?? undefined,
          page_size: DEFAULT_PAGE_SIZE,
        })
        .then((r) => r),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastIdOf(lastPage),
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

/**
 * New: list group chats the current user is a member of.
 */
export function useGroupChats() {
  return useInfiniteQuery({
    queryKey: ["chats", "group"],
    queryFn: ({ pageParam }) =>
      chatsApi
        .getAllGroupChats({
          last_id: pageParam ?? undefined,
          page_size: DEFAULT_PAGE_SIZE,
        })
        .then((r) => r),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastIdOf(lastPage),
    staleTime: 30_000,
  });
}

/**
 * Create a new group chat.
 * Backend requires `public_key` — for MVP we use the creator's own
 * public key (per design.md §10 + report_for_backend/02).
 */
export function useCreateGroupChat() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (req: { name: string }): Promise<chatsApi.GroupChat> => {
      const publicKeyArmored = useKeyringStore.getState().publicKeyArmored;
      if (publicKeyArmored === null) {
        throw new Error("Public key not set — go to /setup-key first");
      }
      return chatsApi.createGroupChat({
        name: req.name,
        public_key: publicKeyArmored,
      });
    },
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
    enabled: chatId !== undefined,
    staleTime: 60_000,
  });
}
