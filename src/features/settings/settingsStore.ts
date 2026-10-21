import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { MantineColorScheme } from "@mantine/core";

export type ColorScheme = MantineColorScheme;

export type RealtimeMode = "ws" | "polling";

export interface Settings {
  theme: ColorScheme;
  pollingIntervalMs: number;
  idleTimeoutMs: number;
  autoLockEnabled: boolean;
  language: "en" | "ru" | "vi";
  apiBaseUrl: string;
  notificationsEnabled: boolean;
  realtimeMode: RealtimeMode;
  /**
   * Web Push subscription switch (B2). Explicit opt-in, default `false` —
   * push is only ever (re)subscribed after the user flips the toggle in
   * Settings (or unlock re-registers an already-enabled subscription).
   */
  pushEnabled: boolean;
  /**
   * Local retention sweep (days) for the encrypted dialog store. `0` means
   * "keep forever"; server history is unaffected by local cleanup.
   */
  chatRetentionDays: number;
  /** Local retention sweep (days) for the media vault. `0` = keep forever. */
  mediaRetentionDays: number;
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
  "realtimeMode",
  "pushEnabled",
  "chatRetentionDays",
  "mediaRetentionDays",
] as const satisfies readonly (keyof Settings)[];

const viteApiUrl = (import.meta.env as { VITE_API_URL?: unknown }).VITE_API_URL;

const defaults: Settings = {
  theme: "dark",
  pollingIntervalMs: 5000,
  idleTimeoutMs: 300_000,
  autoLockEnabled: true,
  language: "ru",
  apiBaseUrl:
    typeof viteApiUrl === "string" && viteApiUrl.length > 0 ? viteApiUrl : "http://localhost:8000",
  notificationsEnabled: true,
  realtimeMode: "ws",
  pushEnabled: false,
  chatRetentionDays: 90,
  mediaRetentionDays: 30,
};

const tauriStore = new LazyStore("settings.json");

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaults,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    // Browser dev (vite) has no Tauri store backend — persistence is
    // best-effort there. In-memory defaults still apply so the UI works.
    try {
      await tauriStore.init();
    } catch {
      set({ ...defaults, hydrated: true });
      return;
    }
    const loaded: Record<string, unknown> = {};
    for (const key of SETTINGS_KEYS) {
      try {
        const value = await tauriStore.get(key);
        if (value !== undefined) {
          loaded[key] = value;
        }
      } catch {
        // ignore per-key read failures (no backend in browser)
      }
    }
    // Migration / validation: old settings.json files have no
    // `realtimeMode` key (falls back to default via spread below);
    // a corrupted value is dropped so the default ("ws") wins.
    if (loaded.realtimeMode !== "ws" && loaded.realtimeMode !== "polling") {
      delete loaded.realtimeMode;
    }
    // Same for `pushEnabled` (B2): pre-push settings files have no key,
    // and any non-boolean persisted value falls back to `false`.
    if (typeof loaded.pushEnabled !== "boolean") {
      delete loaded.pushEnabled;
    }
    // Retention settings (local sweep): only finite, non-negative day
    // counts are accepted; strings / negatives / NaN / Infinity are
    // dropped so the defaults (90 / 30) win.
    for (const key of ["chatRetentionDays", "mediaRetentionDays"] as const) {
      const value = loaded[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        delete loaded[key];
      }
    }
    set({ ...defaults, ...loaded, hydrated: true });
  },

  set: async (key, value) => {
    set({ [key]: value } as Partial<SettingsState>);
    // Persist best-effort: Tauri store backend is absent in plain
    // browser dev (vite), where save() rejects. In-memory state above
    // is the source of truth; a failed persist must not surface as
    // Uncaught (in promise) in the console.
    try {
      await tauriStore.set(key, value);
      await tauriStore.save();
    } catch {
      // ignore — next launch falls back to defaults for missing keys
    }
  },

  reset: async () => {
    set({ ...defaults });
    try {
      await tauriStore.clear();
      await tauriStore.save();
    } catch {
      // ignore — see set() above
    }
  },
}));
