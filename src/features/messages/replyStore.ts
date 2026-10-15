import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import type { ReplyRef } from "./replyEnvelope";

export interface ReplyState {
  replies: Record<string, ReplyRef | undefined>;
  setReply: (chatId: string, reply: ReplyRef) => void;
  clearReply: (chatId: string) => void;
}

export const useReplyStore = create<ReplyState>()(
  subscribeWithSelector((set) => ({
    replies: {},
    setReply: (chatId, reply) => set((s) => ({ replies: { ...s.replies, [chatId]: reply } })),
    clearReply: (chatId) =>
      set((s) => {
        if (s.replies[chatId] === undefined) return s;
        const next = { ...s.replies };
        delete next[chatId];
        return { replies: next };
      }),
  })),
);
