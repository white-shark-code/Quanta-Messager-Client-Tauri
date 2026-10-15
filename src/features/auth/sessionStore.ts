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
  /**
   * Soft-lock: revokes the access token and flips `isUnlocked` off,
   * but RETAINS `user` identity so `UnlockAgainModal` / reauth can
   * recover without asking for email/login again.
   * Key material must be wiped separately at the call site
   * (`keyringStore.clear()` + `clearDecryptedCache()`), see `useIdleTimeout`.
   */
  lock: () => void;
  /**
   * Hard logout (explicit user action): same as `lock()` plus
   * wipes `user` identity. Caller must also clear key material.
   */
  logout: () => void;
  /**
   * 401 handler — same semantics as soft `lock()` (identity retained
   * for the reauth modal).
   */
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
    set({ isUnlocked: false, fingerprint: null });
  },
  logout: () => {
    clearAccessToken();
    set({ user: null, isUnlocked: false, fingerprint: null });
  },
  onUnauthorized: () => {
    clearAccessToken();
    set({ isUnlocked: false, fingerprint: null });
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
