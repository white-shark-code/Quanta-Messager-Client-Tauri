import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

/** Forward destination chat. */
export interface ForwardTarget {
  chatId: string;
  kind: "private" | "group";
}

export interface ForwardState {
  /** Source chatId -> selected message ids (deduped, insertion-ordered). */
  selection: Record<string, string[]>;
  /** Forward destination picked in the target picker, or null. */
  target: ForwardTarget | null;
  toggleSelect: (chatId: string, messageId: string) => void;
  clearSelection: (chatId: string) => void;
  clearAll: () => void;
  setTarget: (t: ForwardTarget) => void;
  clearTarget: () => void;
}

export const useForwardStore = create<ForwardState>()(
  subscribeWithSelector((set) => ({
    selection: {},
    target: null,
    toggleSelect: (chatId, messageId) =>
      set((s) => {
        const current = s.selection[chatId] ?? [];
        if (current.includes(messageId)) {
          const next = current.filter((id) => id !== messageId);
          if (next.length === 0) {
            if (s.selection[chatId] === undefined) return s;
            const selection = { ...s.selection };
            delete selection[chatId];
            return { selection };
          }
          return { selection: { ...s.selection, [chatId]: next } };
        }
        return { selection: { ...s.selection, [chatId]: [...current, messageId] } };
      }),
    clearSelection: (chatId) =>
      set((s) => {
        if (s.selection[chatId] === undefined) return s;
        const selection = { ...s.selection };
        delete selection[chatId];
        return { selection };
      }),
    clearAll: () =>
      set((s) => {
        if (Object.keys(s.selection).length === 0) return s;
        return { selection: {} };
      }),
    setTarget: (t) => set({ target: t }),
    clearTarget: () => set({ target: null }),
  })),
);
