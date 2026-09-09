import type { MantineColorScheme } from "@mantine/core";
export type ColorScheme = MantineColorScheme;
export interface Settings {
    theme: ColorScheme;
    pollingIntervalMs: number;
    idleTimeoutMs: number;
    autoLockEnabled: boolean;
    language: "en" | "ru" | "vi";
    apiBaseUrl: string;
    notificationsEnabled: boolean;
}
export interface SettingsState extends Settings {
    hydrated: boolean;
    hydrate: () => Promise<void>;
    set: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
    reset: () => Promise<void>;
}
export declare const useSettingsStore: import("zustand").UseBoundStore<import("zustand").StoreApi<SettingsState>>;
