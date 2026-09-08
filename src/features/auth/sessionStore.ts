import { create } from "zustand";

import { configureClient } from "@/infra/apiClient";

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
  lock: () => set({ user: null, isUnlocked: false, fingerprint: null }),
  onUnauthorized: () => set({ user: null, isUnlocked: false, fingerprint: null }),
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
