import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getAllEvents } from "./api";
import { useSessionStore } from "@/features/auth/sessionStore";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { onAppEvent } from "@/infra/tauriBridge";
export function useEventsPolling() {
    const isUnlocked = useSessionStore((s) => s.isUnlocked);
    const pollingIntervalMs = useSettingsStore((s) => s.pollingIntervalMs);
    const [paused, setPaused] = useState(false);
    useEffect(() => {
        if (typeof document === "undefined")
            return;
        const handler = () => setPaused(document.hidden);
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
    }, []);
    useEffect(() => {
        if (typeof window === "undefined")
            return;
        if (!("__TAURI_INTERNALS__" in window))
            return;
        let unlistenPaused;
        let unlistenResumed;
        void onAppEvent("paused", () => setPaused(true)).then((u) => {
            unlistenPaused = u;
        });
        void onAppEvent("resumed", () => setPaused(false)).then((u) => {
            unlistenResumed = u;
        });
        return () => {
            unlistenPaused?.();
            unlistenResumed?.();
        };
    }, []);
    return useQuery({
        queryKey: ["events"],
        queryFn: () => getAllEvents(),
        enabled: isUnlocked && !paused,
        refetchInterval: pollingIntervalMs,
        staleTime: 0,
    });
}
