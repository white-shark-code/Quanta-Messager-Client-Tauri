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
    updateMediaStatus: (chatId: string, mediaId: string, status: MediaDraftStatus, progress?: number) => void;
    removeMedia: (chatId: string, mediaId: string) => void;
    clearDraft: (chatId: string) => void;
    getDraft: (chatId: string) => ComposerDraft | undefined;
}
export declare const useComposerStore: import("zustand").UseBoundStore<Omit<import("zustand").StoreApi<ComposerState>, "subscribe"> & {
    subscribe: {
        (listener: (selectedState: ComposerState, previousSelectedState: ComposerState) => void): () => void;
        <U>(selector: (state: ComposerState) => U, listener: (selectedState: U, previousSelectedState: U) => void, options?: {
            equalityFn?: ((a: U, b: U) => boolean) | undefined;
            fireImmediately?: boolean;
        } | undefined): () => void;
    };
}>;
