import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
export const useComposerStore = create()(subscribeWithSelector((set, get) => ({
    drafts: {},
    setText: (chatId, text) => set((s) => {
        const existing = s.drafts[chatId];
        const mediaFiles = existing?.mediaFiles ?? [];
        return {
            drafts: {
                ...s.drafts,
                [chatId]: { text, mediaFiles, updatedAt: Date.now() },
            },
        };
    }),
    addMedia: (chatId, file) => set((s) => {
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
    updateMediaStatus: (chatId, mediaId, status, progress) => set((s) => {
        const draft = s.drafts[chatId];
        if (!draft)
            return s;
        return {
            drafts: {
                ...s.drafts,
                [chatId]: {
                    ...draft,
                    mediaFiles: draft.mediaFiles.map((m) => {
                        if (m.id !== mediaId)
                            return m;
                        return progress !== undefined
                            ? { ...m, status, progress }
                            : { ...m, status };
                    }),
                },
            },
        };
    }),
    removeMedia: (chatId, mediaId) => set((s) => {
        const draft = s.drafts[chatId];
        if (!draft)
            return s;
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
    clearDraft: (chatId) => set((s) => {
        const next = { ...s.drafts };
        delete next[chatId];
        return { drafts: next };
    }),
    getDraft: (chatId) => get().drafts[chatId],
})));
