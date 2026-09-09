import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { clearDecryptedCache } from "@/features/messages/queries";
import { useSessionStore } from "./sessionStore";
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll"];
export function useIdleTimeout() {
    const idleTimeoutMs = useSettingsStore((s) => s.idleTimeoutMs);
    const autoLockEnabled = useSettingsStore((s) => s.autoLockEnabled);
    const isUnlocked = useSessionStore((s) => s.isUnlocked);
    const lock = useSessionStore((s) => s.lock);
    const keyringLock = useKeyringStore((s) => s.lock);
    const timeoutRef = useRef(undefined);
    useEffect(() => {
        if (!autoLockEnabled || !isUnlocked)
            return;
        const resetTimer = () => {
            if (timeoutRef.current !== undefined) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = window.setTimeout(() => {
                keyringLock();
                lock();
                clearDecryptedCache();
            }, idleTimeoutMs);
        };
        ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));
        resetTimer();
        return () => {
            ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer));
            if (timeoutRef.current !== undefined) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = undefined;
            }
        };
    }, [autoLockEnabled, isUnlocked, idleTimeoutMs, lock, keyringLock]);
}
