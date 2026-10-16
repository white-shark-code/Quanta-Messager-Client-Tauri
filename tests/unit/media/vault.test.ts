import { beforeEach, describe, expect, it, vi } from "vitest";

import { useKeyringStore } from "@/features/keyring/keyringStore";
import {
  clearMediaVault,
  deleteMediaForChat,
  readMediaVault,
  writeMediaVault,
} from "@/features/media/vault";

const files = new Map<string, Uint8Array>();
let indexJson = "";

vi.mock("@/infra/tauriBridge", () => ({
  readMediaBuffer: (userId: string, mediaId: string): Promise<Uint8Array> => {
    const data = files.get(`${userId}/${mediaId}`);
    return data === undefined ? Promise.reject(new Error("miss")) : Promise.resolve(data);
  },
  writeMediaBuffer: (userId: string, mediaId: string, data: Uint8Array): Promise<void> => {
    files.set(`${userId}/${mediaId}`, data);
    return Promise.resolve();
  },
  hasMedia: (userId: string, mediaId: string): Promise<boolean> =>
    Promise.resolve(files.has(`${userId}/${mediaId}`)),
  deleteMediaFile: (userId: string, mediaId: string): Promise<void> => {
    files.delete(`${userId}/${mediaId}`);
    return Promise.resolve();
  },
  readMediaIndex: (): Promise<string> => Promise.resolve(indexJson),
  writeMediaIndex: (_userId: string, json: string): Promise<void> => {
    indexJson = json;
    return Promise.resolve();
  },
}));

/** Deterministic 32-byte ChaCha key, base64-encoded. */
function testKeyB64(): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (i * 7 + 3) % 256;
  }
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

const BYTES = new Uint8Array([0x42, 0x4d, 1, 2, 3, 255, 0, 128]);

describe("media/vault", () => {
  beforeEach(() => {
    files.clear();
    indexJson = "";
    useKeyringStore.setState({ dialogKeyB64: testKeyB64() });
  });

  it("round-trips decrypted bytes and mime", async () => {
    const ok = await writeMediaVault("u1", {
      mediaId: "m1",
      plain: BYTES,
      mime: "image/bmp",
      chatId: "c1",
      messageId: "msg1",
    });
    expect(ok).toBe(true);
    const hit = await readMediaVault("u1", "m1");
    expect(hit?.mime).toBe("image/bmp");
    expect(hit?.bytes).toEqual(BYTES);
  });

  it("returns undefined on miss", async () => {
    await expect(readMediaVault("u1", "nope")).resolves.toBeUndefined();
  });

  it("refuses writes and reads without an unlocked dialogKey", async () => {
    useKeyringStore.setState({ dialogKeyB64: null });
    await expect(
      writeMediaVault("u1", { mediaId: "m1", plain: BYTES, mime: "image/bmp" }),
    ).resolves.toBe(false);
    await expect(readMediaVault("u1", "m1")).resolves.toBeUndefined();
  });

  it("deletes corrupt entries on sight and reports a miss", async () => {
    files.set("u1/bad", new Uint8Array([1, 2, 3, 4]));
    await expect(readMediaVault("u1", "bad")).resolves.toBeUndefined();
    expect(files.has("u1/bad")).toBe(false);
  });

  it("evicts least-recently-used entries over quota", async () => {
    const ten = new Uint8Array(10);
    await writeMediaVault("u1", { mediaId: "a", plain: ten, mime: "x", quotaBytes: 15 });
    // Touch `a` is older than `b` by construction (sequential writes).
    await writeMediaVault("u1", { mediaId: "b", plain: ten, mime: "x", quotaBytes: 15 });
    await expect(readMediaVault("u1", "a")).resolves.toBeUndefined();
    const hit = await readMediaVault("u1", "b");
    expect(hit?.bytes).toEqual(ten);
  });

  it("deleteMediaForChat removes only linked entries", async () => {
    await writeMediaVault("u1", { mediaId: "m1", plain: BYTES, mime: "x", chatId: "c1" });
    await writeMediaVault("u1", { mediaId: "m2", plain: BYTES, mime: "x", chatId: "c2" });
    await writeMediaVault("u1", { mediaId: "m3", plain: BYTES, mime: "x" });
    expect(await deleteMediaForChat("u1", "c1")).toBe(1);
    await expect(readMediaVault("u1", "m1")).resolves.toBeUndefined();
    expect((await readMediaVault("u1", "m2"))?.bytes).toEqual(BYTES);
    expect((await readMediaVault("u1", "m3"))?.bytes).toEqual(BYTES);
  });

  it("clearMediaVault wipes everything", async () => {
    await writeMediaVault("u1", { mediaId: "m1", plain: BYTES, mime: "x" });
    await writeMediaVault("u1", { mediaId: "m2", plain: BYTES, mime: "x" });
    await clearMediaVault("u1");
    await expect(readMediaVault("u1", "m1")).resolves.toBeUndefined();
    await expect(readMediaVault("u1", "m2")).resolves.toBeUndefined();
    expect(files.size).toBe(0);
  });
});
