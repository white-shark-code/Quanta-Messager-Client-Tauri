import { create } from "zustand";

import { configureClient } from "@/infra/apiClient";

import { clearAccessToken } from "./accessToken";
import type { User } from "./model";

export interface SessionState {
  user: User | null;
  isUnlocked: boolean;
  fingerprint: string | null;
  setUser: (user: User | null) => void;
  setUnlocked: (unlocked: boolean) => void;
  setFingerprint: (fingerprint: string | null) => void;
  lock: () => void;
  onUnauthorized: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  isUnlocked: false,
  fingerprint: null,
  setUser: (user) => set({ user }),
  setUnlocked: (isUnlocked) => set({ isUnlocked }),
  setFingerprint: (fingerprint) => set({ fingerprint }),
  lock: () => {
    clearAccessToken();
    set({ user: null, isUnlocked: false, fingerprint: null });
  },
  onUnauthorized: () => {
    clearAccessToken();
    set({ user: null, isUnlocked: false, fingerprint: null });
  },
}));

let tokenProvider: () => string | null = () => null;

export function bindTokenProvider(getToken: () => string | null): void {
  tokenProvider = getToken;
  configureClient({
    tokenProvider: () => tokenProvider(),
    onUnauthorized: () => useSessionStore.getState().lock(),
  });
}

bindTokenProvider(() => null);

/**
 * Subscribe to lock transitions (`isUnlocked: true → false`) for
 * session-scoped resources such as the future WS events socket.
 *
 * `useEventsSocket` should `onLocked(() => socket.close())` on mount
 * (and reconnect on unlock) instead of polling. Covers `lock()`,
 * `onUnauthorized()` and any other path that flips `isUnlocked` off.
 *
 * @returns Unsubscribe function (same contract as `store.subscribe`).
 */
export function onLocked(listener: () => void): () => void {
  return useSessionStore.subscribe((s, prev) => {
    if (prev.isUnlocked && !s.isUnlocked) {
      listener();
    }
  });
}
