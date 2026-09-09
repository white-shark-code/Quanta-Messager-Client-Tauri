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
export declare const useSessionStore: import("zustand").UseBoundStore<import("zustand").StoreApi<SessionState>>;
export declare function bindTokenProvider(getToken: () => string | null): void;
