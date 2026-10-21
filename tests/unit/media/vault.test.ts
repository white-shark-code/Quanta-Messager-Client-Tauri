import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useKeyringStore } from "@/features/keyring/keyringStore";
import {
  clearMediaVault,
  deleteMediaForChat,
  readMediaVault,
  writeMediaVault,
} from "@/features/media/vault";

const files = new Map<string, Uint8Array>();
let indexJson = "";
/** Simulates `readMediaIndex` rejecting (storage failure). */
let failMediaIndexRead = false;

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
  readMediaIndex: (): Promise<string> =>
    failMediaIndexRead
      ? Promise.reject(new Error("media index read failed"))
      : Promise.resolve(indexJson),
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
    failMediaIndexRead = false;
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

  it("clearMediaVault wipes everything and returns the deleted count", async () => {
    await writeMediaVault("u1", { mediaId: "m1", plain: BYTES, mime: "x" });
    await writeMediaVault("u1", { mediaId: "m2", plain: BYTES, mime: "x" });
    await expect(clearMediaVault("u1")).resolves.toBe(2);
    await expect(readMediaVault("u1", "m1")).resolves.toBeUndefined();
    await expect(readMediaVault("u1", "m2")).resolves.toBeUndefined();
    expect(files.size).toBe(0);
  });

  it("clearMediaVault returns 0 and never throws when the index read fails", async () => {
    await writeMediaVault("u1", { mediaId: "m1", plain: BYTES, mime: "x" });
    failMediaIndexRead = true;
    await expect(clearMediaVault("u1")).resolves.toBe(0);
    // Best-effort: nothing was deleted and the (kept) entry survives.
    expect(files.has("u1/m1")).toBe(true);
  });

  it("writeMediaVault stamps the just-written index entry with storedAt (epoch ms)", async () => {
    await writeMediaVault("u1", { mediaId: "m1", plain: BYTES, mime: "x" });
    const entries = JSON.parse(indexJson) as { id: string; storedAt?: unknown }[];
    const entry = entries.find((e) => e.id === "m1");
    expect(typeof entry?.storedAt).toBe("number");
    expect(entry?.storedAt as number).toBeGreaterThan(0);
  });
});

/**
 * applyMediaRetention — retention sweep для медиа-vault'а. Контракт
 * реализации (ещё нет — TDD):
 *
 *   `applyMediaRetention(userId, retentionDays): Promise<number>`
 *   - retentionDays <= 0 → 0, no-op;
 *   - cutoff = Date.now() - retentionDays * 86_400_000;
 *   - якорь возраста записи = entry.storedAt ?? entry.lastAccess;
 *     записи без обоих полей ОСТАЮТСЯ;
 *   - жертвы удаляются через deleteMediaFile(userId, entry.id),
 *     индекс перезаписывается без них; возвращает число удалённых;
 *   - ошибка чтения индекса → 0, никогда не бросает.
 */
describe("media/vault: applyMediaRetention (retention sweep)", () => {
  const NOW = 1_800_000_000_000;
  const DAY = 86_400_000;
  let applyMediaRetention: (userId: string, retentionDays: number) => Promise<number>;

  function seedIndex(entries: unknown[]): void {
    indexJson = JSON.stringify(entries);
  }

  function parsedIndexIds(): string[] {
    return (JSON.parse(indexJson) as { id: string }[]).map((e) => e.id);
  }

  beforeEach(async () => {
    // This suite lives outside the `media/vault` describe, so reset the
    // in-memory vault state it relies on explicitly.
    files.clear();
    indexJson = "";
    failMediaIndexRead = false;
    const vault = (await import("@/features/media/vault")) as unknown as {
      applyMediaRetention: (userId: string, retentionDays: number) => Promise<number>;
    };
    applyMediaRetention = vault.applyMediaRetention;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes entries whose age anchor (storedAt / lastAccess) is older than the cutoff", async () => {
    files.set("u1/old-stored", new Uint8Array([1]));
    files.set("u1/old-access", new Uint8Array([2]));
    files.set("u1/fresh", new Uint8Array([3]));
    files.set("u1/anchorless", new Uint8Array([4]));
    seedIndex([
      // storedAt — якорь возрастает.
      { id: "old-stored", size: 1, lastAccess: NOW, storedAt: NOW - 40 * DAY },
      // storedAt свежий — хранится, даже если lastAccess старый.
      { id: "fresh", size: 1, lastAccess: 1, storedAt: NOW - 2 * DAY },
      // storedAt нет — fallback на lastAccess.
      { id: "old-access", size: 1, lastAccess: NOW - 40 * DAY },
      // якорей нет вообще — остаётся.
      { id: "anchorless", size: 1 },
    ]);

    await expect(applyMediaRetention("u1", 30)).resolves.toBe(2);

    expect(files.has("u1/old-stored")).toBe(false);
    expect(files.has("u1/old-access")).toBe(false);
    expect(files.has("u1/fresh")).toBe(true);
    expect(files.has("u1/anchorless")).toBe(true);
    expect(new Set(parsedIndexIds())).toEqual(new Set(["fresh", "anchorless"]));
  });

  it("retentionDays=0 — no-op: index untouched, no deletions", async () => {
    files.set("u1/m1", new Uint8Array([1]));
    seedIndex([{ id: "m1", size: 1, lastAccess: 1, storedAt: 1 }]);
    const indexBefore = indexJson;

    await expect(applyMediaRetention("u1", 0)).resolves.toBe(0);

    expect(files.has("u1/m1")).toBe(true);
    expect(indexJson).toBe(indexBefore);
  });

  it("index read failure → 0, nothing deleted, never throws", async () => {
    files.set("u1/m1", new Uint8Array([1]));
    seedIndex([{ id: "m1", size: 1, lastAccess: 0, storedAt: 0 }]);
    failMediaIndexRead = true;

    await expect(applyMediaRetention("u1", 30)).resolves.toBe(0);

    expect(files.has("u1/m1")).toBe(true);
    expect(parsedIndexIds()).toEqual(["m1"]);
  });

  it("empty index → 0 without writes", async () => {
    seedIndex([]);
    await expect(applyMediaRetention("u1", 30)).resolves.toBe(0);
    expect(indexJson).toBe(JSON.stringify([]));
    expect(files.size).toBe(0);
  });
});
