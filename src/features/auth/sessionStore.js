import { create } from "zustand";
import { configureClient } from "@/infra/apiClient";
export const useSessionStore = create((set) => ({
    user: null,
    isUnlocked: false,
    fingerprint: null,
    setUser: (user) => set({ user }),
    setUnlocked: (isUnlocked) => set({ isUnlocked }),
    setFingerprint: (fingerprint) => set({ fingerprint }),
    lock: () => set({ user: null, isUnlocked: false, fingerprint: null }),
    onUnauthorized: () => set({ user: null, isUnlocked: false, fingerprint: null }),
}));
let tokenProvider = () => null;
export function bindTokenProvider(getToken) {
    tokenProvider = getToken;
    configureClient({
        tokenProvider: () => tokenProvider(),
        onUnauthorized: () => useSessionStore.getState().lock(),
    });
}
bindTokenProvider(() => null);
