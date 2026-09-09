import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";
const SETTINGS_KEYS = [
    "theme",
    "pollingIntervalMs",
    "idleTimeoutMs",
    "autoLockEnabled",
    "language",
    "apiBaseUrl",
    "notificationsEnabled",
];
const defaults = {
    theme: "dark",
    pollingIntervalMs: 5000,
    idleTimeoutMs: 300_000,
    autoLockEnabled: true,
    language: "ru",
    apiBaseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
    notificationsEnabled: true,
};
const tauriStore = new LazyStore("settings.json");
export const useSettingsStore = create((set, get) => ({
    ...defaults,
    hydrated: false,
    hydrate: async () => {
        if (get().hydrated)
            return;
        await tauriStore.init();
        const loaded = {};
        for (const key of SETTINGS_KEYS) {
            const value = await tauriStore.get(key);
            if (value !== undefined) {
                loaded[key] = value;
            }
        }
        set({ ...defaults, ...loaded, hydrated: true });
    },
    set: async (key, value) => {
        set({ [key]: value });
        await tauriStore.set(key, value);
        await tauriStore.save();
    },
    reset: async () => {
        await tauriStore.clear();
        set({ ...defaults });
        await tauriStore.save();
    },
}));
