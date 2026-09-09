import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";
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

const SETTINGS_KEYS = [
  "theme",
  "pollingIntervalMs",
  "idleTimeoutMs",
  "autoLockEnabled",
  "language",
  "apiBaseUrl",
  "notificationsEnabled",
] as const satisfies readonly (keyof Settings)[];

const defaults: Settings = {
  theme: "dark",
  pollingIntervalMs: 5000,
  idleTimeoutMs: 300_000,
  autoLockEnabled: true,
  language: "ru",
  apiBaseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  notificationsEnabled: true,
};

const tauriStore = new LazyStore("settings.json");

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaults,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    await tauriStore.init();
    const loaded: Record<string, unknown> = {};
    for (const key of SETTINGS_KEYS) {
      const value = await tauriStore.get(key);
      if (value !== undefined) {
        loaded[key] = value;
      }
    }
    set({ ...defaults, ...loaded, hydrated: true });
  },

  set: async (key, value) => {
    set({ [key]: value } as Partial<SettingsState>);
    await tauriStore.set(key, value);
    await tauriStore.save();
  },

  reset: async () => {
    await tauriStore.clear();
    set({ ...defaults });
    await tauriStore.save();
  },
}));
