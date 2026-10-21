import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract under test (`src/features/settings/retention.ts`, not yet
 * implemented — TDD): `runRetentionSweep(userId)` reads both retention
 * settings from the REAL `useSettingsStore`, applies per-domain sweeps
 * through `applyDialogRetention` / `applyMediaRetention`, and resolves
 * with `{ msgsDeleted, mediaDeleted }` — or `null` when both retention
 * days are `0` (keep forever). The aggregate is logged via
 * `debugLog("retention.sweep", ...)`.
 */

const retentionMocks = vi.hoisted(() => ({
  applyDialogRetention: vi.fn((): Promise<number> => Promise.resolve(0)),
  applyMediaRetention: vi.fn((): Promise<number> => Promise.resolve(0)),
}));

const debugMocks = vi.hoisted(() => ({
  debugLog: vi.fn(),
}));

vi.mock("@/features/dialog-store/store", () => ({
  applyDialogRetention: retentionMocks.applyDialogRetention,
}));

vi.mock("@/features/media/vault", () => ({
  applyMediaRetention: retentionMocks.applyMediaRetention,
}));

vi.mock("@/lib/debug", () => ({
  debugLog: debugMocks.debugLog,
}));

// The module under test drives the real zustand settings store; replicate
// the LazyStore double (Map-backed) from tests/unit/settings/settingsStore.test.ts
// so importing that store stays side-effect free in the node test env.
const pluginStoreState = vi.hoisted(() => ({ data: new Map<string, unknown>() }));

vi.mock("@tauri-apps/plugin-store", () => {
  class LazyStore {
    private readonly path: string;
    constructor(path: string) {
      this.path = path;
    }

    init(): Promise<void> {
      return Promise.resolve();
    }

    get<T>(key: string): Promise<T | undefined> {
      if (!pluginStoreState.data.has(key)) return Promise.resolve(undefined);
      return Promise.resolve(pluginStoreState.data.get(key) as T);
    }

    set(key: string, value: unknown): Promise<void> {
      pluginStoreState.data.set(key, value);
      return Promise.resolve();
    }

    save(): Promise<void> {
      return Promise.resolve();
    }

    clear(): Promise<void> {
      pluginStoreState.data.clear();
      return Promise.resolve();
    }
  }

  return { LazyStore };
});

import { useSettingsStore } from "@/features/settings/settingsStore";

/** Contract shape of the {@link runRetentionSweep} resolution value. */
interface RetentionSweepResult {
  msgsDeleted: number;
  mediaDeleted: number;
}

/**
 * Loads the module under test. Untyped dynamic import (module doesn't
 * exist yet — TDD) with the documented contract shape asserted below.
 * TODO: remove this helper-style cast when `retention.ts` lands.
 */
async function loadRunRetentionSweep(): Promise<
  (userId: string) => Promise<RetentionSweepResult | null>
> {
  const mod = (await import("@/features/settings/retention")) as {
    runRetentionSweep: (userId: string) => Promise<RetentionSweepResult | null>;
  };
  return mod.runRetentionSweep;
}

/**
 * Sets the two (future) retention settings through zustand's state
 * setter — the retention keys don't exist in the store yet, so the
 * partial is cast for now. TODO: drop the cast when the settings land.
 */
function setRetentionSettings(chatRetentionDays: number, mediaRetentionDays: number): void {
  useSettingsStore.setState({ chatRetentionDays, mediaRetentionDays } as unknown as Partial<
    Parameters<typeof useSettingsStore.setState>[0]
  >);
}

describe("settings/retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    debugMocks.debugLog.mockReset();
  });

  it("both retention days are 0 → null and no collaborator calls", async () => {
    setRetentionSettings(0, 0);
    const runRetentionSweep = await loadRunRetentionSweep();

    await expect(runRetentionSweep("user-1")).resolves.toBeNull();
    expect(retentionMocks.applyDialogRetention).not.toHaveBeenCalled();
    expect(retentionMocks.applyMediaRetention).not.toHaveBeenCalled();
    expect(debugMocks.debugLog).not.toHaveBeenCalled();
  });

  it("chat 90 / media 0 → only applyDialogRetention(userId, 90)", async () => {
    setRetentionSettings(90, 0);
    const runRetentionSweep = await loadRunRetentionSweep();
    retentionMocks.applyDialogRetention.mockResolvedValue(4);

    const result = await runRetentionSweep("user-2");

    expect(retentionMocks.applyDialogRetention).toHaveBeenCalledTimes(1);
    expect(retentionMocks.applyDialogRetention).toHaveBeenCalledWith("user-2", 90);
    expect(retentionMocks.applyMediaRetention).not.toHaveBeenCalled();
    expect(result).toEqual({ msgsDeleted: 4, mediaDeleted: 0 });
  });

  it("chat 0 / media 30 → only applyMediaRetention(userId, 30)", async () => {
    setRetentionSettings(0, 30);
    const runRetentionSweep = await loadRunRetentionSweep();
    retentionMocks.applyMediaRetention.mockResolvedValue(2);

    const result = await runRetentionSweep("user-3");

    expect(retentionMocks.applyMediaRetention).toHaveBeenCalledTimes(1);
    expect(retentionMocks.applyMediaRetention).toHaveBeenCalledWith("user-3", 30);
    expect(retentionMocks.applyDialogRetention).not.toHaveBeenCalled();
    expect(result).toEqual({ msgsDeleted: 0, mediaDeleted: 2 });
  });

  it("both set → both called respectively, counters taken from the mocks", async () => {
    setRetentionSettings(45, 7);
    const runRetentionSweep = await loadRunRetentionSweep();
    retentionMocks.applyDialogRetention.mockResolvedValue(60);
    retentionMocks.applyMediaRetention.mockResolvedValue(5);

    const result = await runRetentionSweep("user-4");

    expect(retentionMocks.applyDialogRetention).toHaveBeenCalledWith("user-4", 45);
    expect(retentionMocks.applyMediaRetention).toHaveBeenCalledWith("user-4", 7);
    expect(result).toEqual({ msgsDeleted: 60, mediaDeleted: 5 });
  });

  it("logs the aggregate through debugLog('retention.sweep', ...)", async () => {
    setRetentionSettings(90, 30);
    const runRetentionSweep = await loadRunRetentionSweep();
    retentionMocks.applyDialogRetention.mockResolvedValue(1);
    retentionMocks.applyMediaRetention.mockResolvedValue(2);

    await runRetentionSweep("user-5");

    expect(debugMocks.debugLog).toHaveBeenCalledWith(
      "retention.sweep",
      expect.objectContaining({ msgsDeleted: 1, mediaDeleted: 2 }),
    );
  });
});
