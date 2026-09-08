import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export type MediaDraftStatus = "pending" | "encrypted" | "uploaded" | "failed";

export interface MediaDraft {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  status: MediaDraftStatus;
  progress?: number;
}

export interface ComposerDraft {
  text: string;
  mediaFiles: MediaDraft[];
  updatedAt: number;
}

export interface ComposerState {
  drafts: Record<string, ComposerDraft>;
  setText: (chatId: string, text: string) => void;
  addMedia: (chatId: string, file: MediaDraft) => void;
  updateMediaStatus: (
    chatId: string,
    mediaId: string,
    status: MediaDraftStatus,
    progress?: number,
  ) => void;
  removeMedia: (chatId: string, mediaId: string) => void;
  clearDraft: (chatId: string) => void;
  getDraft: (chatId: string) => ComposerDraft | undefined;
}

export const useComposerStore = create<ComposerState>()(
  subscribeWithSelector((set, get) => ({
    drafts: {},
    setText: (chatId, text) =>
      set((s) => {
        const existing = s.drafts[chatId];
        const mediaFiles = existing?.mediaFiles ?? [];
        return {
          drafts: {
            ...s.drafts,
            [chatId]: { text, mediaFiles, updatedAt: Date.now() },
          },
        };
      }),
    addMedia: (chatId, file) =>
      set((s) => {
        const existing = s.drafts[chatId] ?? {
          text: "",
          mediaFiles: [],
          updatedAt: Date.now(),
        };
        return {
          drafts: {
            ...s.drafts,
            [chatId]: {
              ...existing,
              mediaFiles: [...existing.mediaFiles, file],
              updatedAt: Date.now(),
            },
          },
        };
      }),
    updateMediaStatus: (chatId, mediaId, status, progress) =>
      set((s) => {
        const draft = s.drafts[chatId];
        if (!draft) return s;
        return {
          drafts: {
            ...s.drafts,
            [chatId]: {
              ...draft,
              mediaFiles: draft.mediaFiles.map((m) => {
                if (m.id !== mediaId) return m;
                return progress !== undefined
                  ? { ...m, status, progress }
                  : { ...m, status };
              }),
            },
          },
        };
      }),
    removeMedia: (chatId, mediaId) =>
      set((s) => {
        const draft = s.drafts[chatId];
        if (!draft) return s;
        return {
          drafts: {
            ...s.drafts,
            [chatId]: {
              ...draft,
              mediaFiles: draft.mediaFiles.filter((m) => m.id !== mediaId),
            },
          },
        };
      }),
    clearDraft: (chatId) =>
      set((s) => {
        const next = { ...s.drafts };
        delete next[chatId];
        return { drafts: next };
      }),
    getDraft: (chatId) => get().drafts[chatId],
  })),
);
