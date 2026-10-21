import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract under test (`src/features/settings/wipeLocalData.ts`, not yet
 * implemented — TDD): `wipeDeviceData(userId)` runs
 * `clearDialogs(userId)` → `clearMediaVault(userId)` →
 * `deleteKeystoreForUser(userId)` and resolves with
 * `{ dialogs, media }`. Only keystore failures are swallowed
 * (best-effort); unexpected collaborator rejections propagate.
 */
const wipeMocks = vi.hoisted(() => ({
  clearDialogs: vi.fn((): Promise<number> => Promise.resolve(0)),
  clearMediaVault: vi.fn((): Promise<number> => Promise.resolve(0)),
  deleteKeystoreForUser: vi.fn((): Promise<void> => Promise.resolve()),
}));

vi.mock("@/features/dialog-store/store", () => ({
  clearDialogs: wipeMocks.clearDialogs,
}));

vi.mock("@/features/media/vault", () => ({
  clearMediaVault: wipeMocks.clearMediaVault,
}));

vi.mock("@/features/keyring/generate", () => ({
  deleteKeystoreForUser: wipeMocks.deleteKeystoreForUser,
}));

/** Contract shape of the {@link wipeDeviceData} resolution value. */
interface WipeDeviceDataResult {
  dialogs: number;
  media: number;
}

/**
 * Loads the module under test. Kept as a helper so every test gets
 * the same (typed) view of `wipeDeviceData`.
 */
async function loadWipeDeviceData(): Promise<(userId: string) => Promise<WipeDeviceDataResult>> {
  const mod = (await import("@/features/settings/wipeLocalData")) as {
    wipeDeviceData: (userId: string) => Promise<WipeDeviceDataResult>;
  };
  return mod.wipeDeviceData;
}

describe("settings/wipeLocalData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears dialogs, media and the keystore with the userId in that order", async () => {
    const wipeDeviceData = await loadWipeDeviceData();

    wipeMocks.clearDialogs.mockResolvedValue(3);
    wipeMocks.clearMediaVault.mockResolvedValue(7);
    wipeMocks.deleteKeystoreForUser.mockResolvedValue(undefined);

    await expect(wipeDeviceData("user-1")).resolves.toEqual({ dialogs: 3, media: 7 });

    expect(wipeMocks.clearDialogs).toHaveBeenCalledWith("user-1");
    expect(wipeMocks.clearMediaVault).toHaveBeenCalledWith("user-1");
    expect(wipeMocks.deleteKeystoreForUser).toHaveBeenCalledWith("user-1");

    const [dialogsOrder, mediaOrder, keystoreOrder] = [
      wipeMocks.clearDialogs.mock.invocationCallOrder[0],
      wipeMocks.clearMediaVault.mock.invocationCallOrder[0],
      wipeMocks.deleteKeystoreForUser.mock.invocationCallOrder[0],
    ];
    expect(dialogsOrder).toBeLessThan(mediaOrder);
    expect(mediaOrder).toBeLessThan(keystoreOrder);
  });

  it("swallows a keystore failure and still resolves with the counters", async () => {
    const wipeDeviceData = await loadWipeDeviceData();

    wipeMocks.clearDialogs.mockResolvedValue(1);
    wipeMocks.clearMediaVault.mockResolvedValue(0);
    wipeMocks.deleteKeystoreForUser.mockRejectedValue(new Error("keystore boom"));

    await expect(wipeDeviceData("user-2")).resolves.toEqual({ dialogs: 1, media: 0 });
    expect(wipeMocks.deleteKeystoreForUser).toHaveBeenCalledWith("user-2");
  });

  it("propagates an unexpected clearDialogs rejection (only keystore errors are swallowed)", async () => {
    const wipeDeviceData = await loadWipeDeviceData();

    wipeMocks.clearDialogs.mockRejectedValue(new Error("unexpected"));
    wipeMocks.clearMediaVault.mockResolvedValue(2);
    wipeMocks.deleteKeystoreForUser.mockResolvedValue(undefined);

    await expect(wipeDeviceData("user-3")).rejects.toThrow("unexpected");
  });
});
