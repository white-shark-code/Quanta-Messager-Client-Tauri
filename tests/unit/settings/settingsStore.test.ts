import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeState = vi.hoisted(() => {
  return { data: new Map<string, unknown>() };
});

vi.mock("@tauri-apps/plugin-store", () => {
  class LazyStore {
    private readonly path: string;
    constructor(path: string) {
      this.path = path;
    }

    async init(): Promise<void> {
      return Promise.resolve();
    }

    async get<T>(key: string): Promise<T | undefined> {
      if (!storeState.data.has(key)) return undefined;
      return storeState.data.get(key) as T;
    }

    async set(key: string, value: unknown): Promise<void> {
      storeState.data.set(key, value);
    }

    async save(): Promise<void> {
      return Promise.resolve();
    }

    async clear(): Promise<void> {
      storeState.data.clear();
    }

    async delete(key: string): Promise<boolean> {
      return storeState.data.delete(key);
    }

    async has(key: string): Promise<boolean> {
      return storeState.data.has(key);
    }
  }

  return { LazyStore };
});

describe("settings/settingsStore", () => {
  beforeEach(async () => {
    storeState.data.clear();
    vi.resetModules();
  });

  afterEach(() => {
    storeState.data.clear();
  });

  it("exposes the documented default values before hydration", async () => {
    const { useSettingsStore } = await import("@/features/settings/settingsStore");
    const state = useSettingsStore.getState();

    expect(state.theme).toBe("dark");
    expect(state.pollingIntervalMs).toBe(5000);
    expect(state.idleTimeoutMs).toBe(300_000);
    expect(state.autoLockEnabled).toBe(true);
    expect(state.language).toBe("ru");
    expect(state.notificationsEnabled).toBe(true);
    expect(state.apiBaseUrl).toBe("http://localhost:8000");
    expect(state.hydrated).toBe(false);
  });

  it("set() updates the in-memory state and persists to the Tauri store", async () => {
    const { useSettingsStore } = await import("@/features/settings/settingsStore");

    await useSettingsStore.getState().set("theme", "light");
    expect(useSettingsStore.getState().theme).toBe("light");
    expect(storeState.data.get("theme")).toBe("light");

    await useSettingsStore.getState().set("language", "en");
    expect(useSettingsStore.getState().language).toBe("en");
    expect(storeState.data.get("language")).toBe("en");
  });

  it("set() supports numeric and boolean keys", async () => {
    const { useSettingsStore } = await import("@/features/settings/settingsStore");

    await useSettingsStore.getState().set("pollingIntervalMs", 1500);
    await useSettingsStore.getState().set("idleTimeoutMs", 60_000);
    await useSettingsStore.getState().set("autoLockEnabled", false);
    await useSettingsStore.getState().set("notificationsEnabled", false);

    const state = useSettingsStore.getState();
    expect(state.pollingIntervalMs).toBe(1500);
    expect(state.idleTimeoutMs).toBe(60_000);
    expect(state.autoLockEnabled).toBe(false);
    expect(state.notificationsEnabled).toBe(false);
  });

  it("hydrate() is a no-op the second time it is called", async () => {
    const { useSettingsStore } = await import("@/features/settings/settingsStore");

    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().hydrated).toBe(true);

    await useSettingsStore
      .getState()
      .set("language", "vi");
    expect(useSettingsStore.getState().language).toBe("vi");

    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().hydrated).toBe(true);
    expect(useSettingsStore.getState().language).toBe("vi");
  });

  it("hydrate() merges persisted values over the in-memory defaults", async () => {
    storeState.data.set("theme", "light");
    storeState.data.set("pollingIntervalMs", 2500);
    storeState.data.set("autoLockEnabled", false);
    storeState.data.set("language", "en");

    const { useSettingsStore } = await import("@/features/settings/settingsStore");

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.theme).toBe("light");
    expect(state.pollingIntervalMs).toBe(2500);
    expect(state.autoLockEnabled).toBe(false);
    expect(state.language).toBe("en");
    expect(state.idleTimeoutMs).toBe(300_000);
    expect(state.notificationsEnabled).toBe(true);
  });

  it("hydrate() ignores persisted keys that are undefined", async () => {
    storeState.data.set("theme", "light");
    const { useSettingsStore } = await import("@/features/settings/settingsStore");

    await useSettingsStore.getState().hydrate();

    const state = useSettingsStore.getState();
    expect(state.theme).toBe("light");
    expect(state.idleTimeoutMs).toBe(300_000);
    expect(state.apiBaseUrl).toBe("http://localhost:8000");
  });

  it("reset() clears the persisted store and restores the defaults", async () => {
    const { useSettingsStore } = await import("@/features/settings/settingsStore");

    await useSettingsStore.getState().set("theme", "light");
    await useSettingsStore.getState().set("language", "en");
    await useSettingsStore.getState().set("pollingIntervalMs", 9999);
    expect(storeState.data.has("theme")).toBe(true);

    await useSettingsStore.getState().reset();

    const state = useSettingsStore.getState();
    expect(state.theme).toBe("dark");
    expect(state.language).toBe("ru");
    expect(state.pollingIntervalMs).toBe(5000);
    expect(state.idleTimeoutMs).toBe(300_000);
    expect(state.autoLockEnabled).toBe(true);
    expect(state.notificationsEnabled).toBe(true);
    expect(storeState.data.has("theme")).toBe(false);
    expect(storeState.data.has("language")).toBe(false);
    expect(storeState.data.has("pollingIntervalMs")).toBe(false);
  });
});
