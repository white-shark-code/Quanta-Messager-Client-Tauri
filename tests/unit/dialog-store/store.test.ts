import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => {
  const files = new Map<string, Uint8Array>();
  return { files };
});

vi.mock("@tauri-apps/plugin-fs", () => {
  const BaseDirectory = { AppData: 0 };

  const readFile = vi.fn((path: string | URL): Promise<Uint8Array<ArrayBuffer>> => {
    const key = typeof path === "string" ? path : path.toString();
    const buf = fsState.files.get(key);
    if (!buf) return Promise.reject(new Error(`File not found: ${key}`));
    return Promise.resolve(new Uint8Array(buf));
  });

  const writeFile = vi.fn(
    (path: string | URL, data: Uint8Array | ReadableStream<Uint8Array>): Promise<void> => {
      const key = typeof path === "string" ? path : path.toString();
      if (data instanceof Uint8Array) {
        fsState.files.set(key, new Uint8Array(data));
        return Promise.resolve();
      }
      return Promise.reject(new Error("ReadableStream is not supported by the in-memory mock"));
    },
  );

  const exists = vi.fn((path: string | URL): Promise<boolean> => {
    const key = typeof path === "string" ? path : path.toString();
    return Promise.resolve(fsState.files.has(key));
  });

  const remove = vi.fn((path: string | URL): Promise<void> => {
    const key = typeof path === "string" ? path : path.toString();
    fsState.files.delete(key);
    return Promise.resolve();
  });

  const mkdir = vi.fn((): Promise<void> => Promise.resolve());

  return { BaseDirectory, readFile, writeFile, exists, remove, mkdir };
});

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn((): Promise<string> => Promise.resolve("/mock-appdata")),
  join: vi.fn((...args: string[]): Promise<string> => Promise.resolve(args.slice(1).join("/"))),
}));

import { useKeyringStore } from "@/features/keyring/keyringStore";
import {
  appendDialog,
  deleteDialog,
  listDialogs,
  readDialog,
  seedCache,
} from "@/features/dialog-store/store";
import type { DialogMessage } from "@/features/messages/model";

const USER = "user-aaa-111";
const CHAT_A = "chat-aaa";
const CHAT_B = "chat-bbb";

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

function setKeyringKey(seed: number, store = useKeyringStore): void {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (seed + i * 7) & 0xff;
  store.setState({ dialogKeyB64: b64(bytes) });
}

function makeMessage(id: string, when: string, text: string): DialogMessage {
  return {
    id,
    chat_id: CHAT_A,
    owner_id: "owner-x",
    encrypted_message: btoa(`ciphertext-for-${id}`),
    signature: null,
    creation_datetime: when,
    ...({ text } as { text: string }),
  } as DialogMessage;
}

function forceTauriRuntime(): void {
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

beforeEach(() => {
  fsState.files.clear();
  vi.clearAllMocks();
  forceTauriRuntime();
  useKeyringStore.setState({ dialogKeyB64: null });
  setKeyringKey(7);
});

afterEach(() => {
  fsState.files.clear();
  useKeyringStore.setState({ dialogKeyB64: null });
});

describe("dialog-store/store", () => {
  it("readDialog возвращает [] когда файла нет", async () => {
    const result = await readDialog(USER, CHAT_A);
    expect(result).toEqual([]);
  });

  it("appendDialog + readDialog round-trip'ит одно сообщение", async () => {
    const msg = makeMessage("m1", "2026-09-01T10:00:00.000Z", "hello");
    await appendDialog(USER, CHAT_A, msg);

    const result = await readDialog(USER, CHAT_A);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("m1");
  });

  it("два append сохраняют оба сообщения и делают dedupe по id", async () => {
    const a = makeMessage("m1", "2026-09-01T10:00:00.000Z", "first");
    const b = makeMessage("m2", "2026-09-01T10:01:00.000Z", "second");
    const aDup = makeMessage("m1", "2026-09-01T10:00:00.000Z", "first-redacted");

    await appendDialog(USER, CHAT_A, a);
    await appendDialog(USER, CHAT_A, [b, aDup]);

    const result = await readDialog(USER, CHAT_A);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("appendDialog перезаписывает существующий id более новым", async () => {
    const a = makeMessage("m1", "2026-09-01T10:00:00.000Z", "old");
    await appendDialog(USER, CHAT_A, a);

    const aUpdated = makeMessage("m1", "2026-09-01T10:00:01.000Z", "new");
    await appendDialog(USER, CHAT_A, aUpdated);

    const result = await readDialog(USER, CHAT_A);
    expect(result).toHaveLength(1);
  });

  it("возвращает сообщения отсортированными по creation_datetime", async () => {
    const b = makeMessage("m2", "2026-09-01T10:01:00.000Z", "second");
    const a = makeMessage("m1", "2026-09-01T10:00:00.000Z", "first");
    const c = makeMessage("m3", "2026-09-01T10:02:00.000Z", "third");

    await appendDialog(USER, CHAT_A, [b, a, c]);

    const result = await readDialog(USER, CHAT_A);
    expect(result.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("чаты изолированы друг от друга", async () => {
    await appendDialog(USER, CHAT_A, makeMessage("m1", "2026-09-01T10:00:00.000Z", "a"));
    await appendDialog(USER, CHAT_B, makeMessage("m2", "2026-09-01T10:00:00.000Z", "b"));

    const a = await readDialog(USER, CHAT_A);
    const b = await readDialog(USER, CHAT_B);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.id).toBe("m1");
    expect(b[0]?.id).toBe("m2");
  });

  it("listDialogs трекает все чаты, в которые был append", async () => {
    await appendDialog(USER, CHAT_A, makeMessage("m1", "2026-09-01T10:00:00.000Z", "x"));
    await appendDialog(USER, CHAT_B, makeMessage("m2", "2026-09-01T10:00:00.000Z", "y"));

    const chats = await listDialogs(USER);
    expect(new Set(chats)).toEqual(new Set([CHAT_A, CHAT_B]));
  });

  it("deleteDialog удаляет файл и запись в индексе", async () => {
    await appendDialog(USER, CHAT_A, makeMessage("m1", "2026-09-01T10:00:00.000Z", "x"));
    await appendDialog(USER, CHAT_B, makeMessage("m2", "2026-09-01T10:00:00.000Z", "y"));

    await deleteDialog(USER, CHAT_A);

    expect(await readDialog(USER, CHAT_A)).toEqual([]);
    expect(await readDialog(USER, CHAT_B)).toHaveLength(1);
    expect(await listDialogs(USER)).not.toContain(CHAT_A);
  });

  it("readDialog бросает, когда dialogKey стёрт из памяти (после lock)", async () => {
    await appendDialog(USER, CHAT_A, makeMessage("m1", "2026-09-01T10:00:00.000Z", "x"));
    useKeyringStore.setState({ dialogKeyB64: null });

    await expect(readDialog(USER, CHAT_A)).rejects.toThrow(/dialogKey/i);
  });

  it("seedCache возвращает одну страницу InfiniteData, отсортированную по возрастанию", async () => {
    const c = makeMessage("m3", "2026-09-01T10:02:00.000Z", "third");
    const a = makeMessage("m1", "2026-09-01T10:00:00.000Z", "first");
    const b = makeMessage("m2", "2026-09-01T10:01:00.000Z", "second");
    await appendDialog(USER, CHAT_A, [c, a, b]);

    const seeded = await seedCache(USER, CHAT_A);
    expect(seeded).toBeDefined();
    expect(seeded?.pages).toHaveLength(1);
    expect(seeded?.pageParams).toEqual([0]);
    expect(seeded?.pages[0]?.items.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("seedCache возвращает undefined, когда файла нет", async () => {
    const seeded = await seedCache(USER, "never-written");
    expect(seeded).toBeUndefined();
  });

  it("seedCache возвращает undefined на битом файле вместо throw", async () => {
    fsState.files.set(`dialogs/${USER}/${CHAT_A}.qdlog`, new Uint8Array([0x00, 0x01, 0x02]));
    const seeded = await seedCache(USER, CHAT_A);
    expect(seeded).toBeUndefined();
  });
});

/**
 * clearDialogs — часть флоу «Стереть данные устройства» (wipe device
 * data). Контракт — про best-effort поведение на уровне вызовов
 * bridge (readDialogIndex / deleteDialogFile / writeDialogIndex),
 * поэтому здесь bridge мокается целиком через `vi.doMock` +
 * динамический импорт store-модуля, чтобы не мешать интеграционным
 * тестам выше (они живут на in-memory моке plugin-fs).
 */
describe("dialog-store/store: clearDialogs (wipe device data)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/infra/tauriBridge", () => ({
      readDialogIndex: vi.fn((): Promise<string[]> => Promise.resolve([])),
      deleteDialogFile: vi.fn((): Promise<void> => Promise.resolve()),
      writeDialogIndex: vi.fn((): Promise<void> => Promise.resolve()),
    }));
  });

  afterEach(() => {
    vi.doUnmock("@/infra/tauriBridge");
    vi.resetModules();
  });

  /**
   * Загружает свежий экземпляр store-модуля (с замоканным bridge).
   * `clearDialogs` в контракте реализации ещё нет (TDD), поэтому
   * аннотируем его вручную, чтобы деконструкция была типизированной.
   */
  async function loadStore(): Promise<
    typeof import("@/features/dialog-store/store") & {
      clearDialogs: (userId: string) => Promise<number>;
    }
  > {
    return (await import("@/features/dialog-store/store")) as typeof import("@/features/dialog-store/store") & {
      clearDialogs: (userId: string) => Promise<number>;
    };
  }

  it("удаляет файл каждого чата из индекса, пишет пустой индекс и возвращает число диалогов", async () => {
    const bridge = await import("@/infra/tauriBridge");
    vi.mocked(bridge.readDialogIndex).mockResolvedValue([CHAT_A, CHAT_B, "chat-ccc"]);

    const { clearDialogs } = await loadStore();
    const cleared = await clearDialogs(USER);

    expect(cleared).toBe(3);
    expect(bridge.deleteDialogFile).toHaveBeenCalledTimes(3);
    expect(bridge.deleteDialogFile).toHaveBeenCalledWith(USER, CHAT_A);
    expect(bridge.deleteDialogFile).toHaveBeenCalledWith(USER, CHAT_B);
    expect(bridge.deleteDialogFile).toHaveBeenCalledWith(USER, "chat-ccc");
    expect(bridge.writeDialogIndex).toHaveBeenCalledTimes(1);
    expect(bridge.writeDialogIndex).toHaveBeenCalledWith(USER, []);
  });

  it("возвращает 0, когда readDialogIndex отверг — без удалений и без записи индекса", async () => {
    const bridge = await import("@/infra/tauriBridge");
    vi.mocked(bridge.readDialogIndex).mockRejectedValue(new Error("index read failed"));

    const { clearDialogs } = await loadStore();

    await expect(clearDialogs(USER)).resolves.toBe(0);
    expect(bridge.deleteDialogFile).not.toHaveBeenCalled();
    expect(bridge.writeDialogIndex).not.toHaveBeenCalled();
  });

  it("не reject'ит, когда deleteDialogFile падает — всё равно пишет пустой индекс (best-effort)", async () => {
    const bridge = await import("@/infra/tauriBridge");
    vi.mocked(bridge.readDialogIndex).mockResolvedValue([CHAT_A, CHAT_B]);
    vi.mocked(bridge.deleteDialogFile).mockRejectedValue(new Error("remove failed"));

    const { clearDialogs } = await loadStore();

    await expect(clearDialogs(USER)).resolves.toBe(2);
    expect(bridge.deleteDialogFile).toHaveBeenCalledTimes(2);
    expect(bridge.writeDialogIndex).toHaveBeenCalledTimes(1);
    expect(bridge.writeDialogIndex).toHaveBeenCalledWith(USER, []);
  });
});

/**
 * applyDialogRetention — «retention sweep» (автоочистка старой локальной
 * истории). Контракт реализации (ещё нет — TDD):
 *
 *   `applyDialogRetention(userId, retentionDays): Promise<number>`
 *   - retentionDays <= 0 → no-op, 0;
 *   - cutoff = Date.now() - retentionDays * 86_400_000;
 *   - per-chat: сообщения с Date.parse(creation_datetime) >= cutoff
 *     остаются; непарсящиеся даты ОСТАЮТСЯ;
 *   - файл переписывается только если что-то изменилось;
 *   - пустой чат → deleteDialog (файл + запись в индексе);
 *   - возвращает суммарное число удалённых сообщений; не reject'ит.
 */
describe("dialog-store/store: applyDialogRetention (retention sweep)", () => {
  const NOW = Date.parse("2026-09-15T12:00:00.000Z");
  const DAY = 86_400_000;
  const RETENTION_DAYS = 30;
  const OLD_ISO = new Date(NOW - 40 * DAY).toISOString();
  const FRESH_ISO = new Date(NOW - 5 * DAY).toISOString();

  /**
   * Загружает (уже статически закэшированный) store-модуль. `applyDialogRetention`
   * в реализации ещё нет (TDD), поэтому достаём его через каст, чтобы
   * остальной файла оставался типизированным как раньше.
   */
  async function loadRetention(): Promise<{
    applyDialogRetention: (userId: string, retentionDays: number) => Promise<number>;
  }> {
    const mod = (await import("@/features/dialog-store/store")) as unknown as {
      applyDialogRetention: (userId: string, retentionDays: number) => Promise<number>;
    };
    return mod;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // The clearDialogs suite resets the module registry in afterEach; reload
    // the keyring so the dynamically imported store below sees a seeded key.
    vi.resetModules();
    const { useKeyringStore: freshKeyring } = await import("@/features/keyring/keyringStore");
    setKeyringKey(7, freshKeyring);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("оставляет свежие сообщения, переписывает файл и не трогает индекс", async () => {
    await appendDialog(USER, CHAT_A, [
      makeMessage("m-old", OLD_ISO, "old"),
      makeMessage("m-new", FRESH_ISO, "fresh"),
    ]);
    const chatFileKey = `dialogs/${USER}/${CHAT_A}.qdlog`;
    const bytesBefore = fsState.files.get(chatFileKey);

    const { applyDialogRetention } = await loadRetention();
    await expect(applyDialogRetention(USER, RETENTION_DAYS)).resolves.toBe(1);

    // Файл был ПЕРЕЗАПИСАН (не просто прочитан): байты изменились,
    // и после перечитывания остаются только свежие сообщения.
    expect(fsState.files.get(chatFileKey)).toBeDefined();
    expect(fsState.files.get(chatFileKey)).not.toEqual(bytesBefore);
    const kept = await readDialog(USER, CHAT_A);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.id).toBe("m-new");

    // Индекс продолжает перечислять чат.
    await expect(listDialogs(USER)).resolves.toContain(CHAT_A);
  });

  it("возвращает количество удалённых сообщений (старые дропаются)", async () => {
    await appendDialog(USER, CHAT_A, [
      makeMessage("m-ancient", new Date(NOW - 400 * DAY).toISOString(), "ancient"),
      makeMessage("m-old", OLD_ISO, "old"),
      makeMessage("m-new", FRESH_ISO, "fresh"),
      makeMessage("m-newer", new Date(NOW - DAY).toISOString(), "newer"),
    ]);

    const { applyDialogRetention } = await loadRetention();
    await expect(applyDialogRetention(USER, RETENTION_DAYS)).resolves.toBe(2);
    const kept = await readDialog(USER, CHAT_A);
    expect(kept.map((m) => m.id).sort()).toEqual(["m-new", "m-newer"]);
  });

  it("чат, где все сообщения старше cutoff, уходит целиком через deleteDialog", async () => {
    await appendDialog(USER, CHAT_A, [
      makeMessage("m-old-1", OLD_ISO, "a"),
      makeMessage("m-old-2", new Date(NOW - 45 * DAY).toISOString(), "b"),
    ]);
    await appendDialog(USER, CHAT_B, makeMessage("m-survives", FRESH_ISO, "survivor"));
    const chatAFileKey = `dialogs/${USER}/${CHAT_A}.qdlog`;

    const { applyDialogRetention } = await loadRetention();
    await expect(applyDialogRetention(USER, RETENTION_DAYS)).resolves.toBe(2);

    // Файл удалён с диска и запись в индексе продропана.
    expect(fsState.files.has(chatAFileKey)).toBe(false);
    const chats = await listDialogs(USER);
    expect(chats).toContain(CHAT_B);
    expect(chats).not.toContain(CHAT_A);
    expect(await readDialog(USER, CHAT_A)).toEqual([]);
  });

  it("retentionDays=0 — no-op: файл не переписывается, чат не удаляется", async () => {
    await appendDialog(USER, CHAT_A, [makeMessage("m-old", OLD_ISO, "old")]);
    const chatFileKey = `dialogs/${USER}/${CHAT_A}.qdlog`;
    const bytesBefore = fsState.files.get(chatFileKey);
    expect(bytesBefore).toBeDefined();

    const bridge = await import("@/infra/tauriBridge");
    const readIndexSpy = vi.spyOn(bridge, "readDialogIndex");
    const writeBufferSpy = vi.spyOn(bridge, "writeDialogBuffer");
    const deleteFileSpy = vi.spyOn(bridge, "deleteDialogFile");
    const writeIndexSpy = vi.spyOn(bridge, "writeDialogIndex");

    const { applyDialogRetention } = await loadRetention();
    await expect(applyDialogRetention(USER, 0)).resolves.toBe(0);

    expect(readIndexSpy).not.toHaveBeenCalled();
    expect(writeBufferSpy).not.toHaveBeenCalled();
    expect(deleteFileSpy).not.toHaveBeenCalled();
    expect(writeIndexSpy).not.toHaveBeenCalled();

    // Ничего не изменилось на диске.
    expect(fsState.files.get(chatFileKey)).toEqual(bytesBefore);
    expect(await readDialog(USER, CHAT_A)).toHaveLength(1);
  });

  it("сообщение с непарсящимся creation_datetime остаётся (защита от потери данных)", async () => {
    await appendDialog(USER, CHAT_A, [
      makeMessage("m-weird", "not-a-real-date", "weird"),
      makeMessage("m-old", OLD_ISO, "old"),
      makeMessage("m-new", FRESH_ISO, "fresh"),
    ]);

    const { applyDialogRetention } = await loadRetention();
    await expect(applyDialogRetention(USER, RETENTION_DAYS)).resolves.toBe(1);

    const kept = await readDialog(USER, CHAT_A);
    expect(kept.map((m) => m.id).sort()).toEqual(["m-new", "m-weird"]);
  });
});

/**
 * Отдельный describe на failure-режимы: bridge мокается целиком через
 * `vi.doMock` + динамический импорт (тот же паттерн, что у describe
 * clearDialogs выше), чтобы наблюдать именно отказы bridge, а не проверять
 * поведение in-memory plugin-fs.
 */
describe("dialog-store/store: applyDialogRetention (best-effort, bridge failures)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/infra/tauriBridge", () => ({
      readDialogIndex: vi.fn((): Promise<string[]> => Promise.resolve([])),
      hasDialog: vi.fn((): Promise<boolean> => Promise.resolve(true)),
      readDialogBuffer: vi.fn((): Promise<Uint8Array> => Promise.reject(new Error("decrypt boom"))),
      writeDialogBuffer: vi.fn((): Promise<void> => Promise.resolve()),
      writeDialogIndex: vi.fn((): Promise<void> => Promise.resolve()),
      deleteDialogFile: vi.fn((): Promise<void> => Promise.resolve()),
    }));
  });

  afterEach(() => {
    vi.doUnmock("@/infra/tauriBridge");
    vi.resetModules();
  });

  async function loadRetention(): Promise<{
    applyDialogRetention: (userId: string, retentionDays: number) => Promise<number>;
  }> {
    const mod = (await import("@/features/dialog-store/store")) as unknown as {
      applyDialogRetention: (userId: string, retentionDays: number) => Promise<number>;
    };
    return mod;
  }

  it("readDialogIndex отверг → 0 без чтений диалогов и без записей", async () => {
    const bridge = await import("@/infra/tauriBridge");
    vi.mocked(bridge.readDialogIndex).mockRejectedValue(new Error("index read failed"));

    const { applyDialogRetention } = await loadRetention();
    await expect(applyDialogRetention(USER, 30)).resolves.toBe(0);

    expect(bridge.hasDialog).not.toHaveBeenCalled();
    expect(bridge.readDialogBuffer).not.toHaveBeenCalled();
    expect(bridge.writeDialogBuffer).not.toHaveBeenCalled();
    expect(bridge.writeDialogIndex).not.toHaveBeenCalled();
  });

  it("ошибка чтения одного чата глотается — свип продолжается и не reject'ит", async () => {
    const bridge = await import("@/infra/tauriBridge");
    vi.mocked(bridge.readDialogIndex).mockResolvedValue([CHAT_A]);
    vi.mocked(bridge.hasDialog).mockResolvedValue(true);

    const { applyDialogRetention } = await loadRetention();
    await expect(applyDialogRetention(USER, 30)).resolves.toBe(0);

    expect(bridge.readDialogBuffer).toHaveBeenCalledTimes(1);
    expect(bridge.readDialogBuffer).toHaveBeenCalledWith(USER, CHAT_A);
    expect(bridge.writeDialogBuffer).not.toHaveBeenCalled();
    expect(bridge.writeDialogIndex).not.toHaveBeenCalled();
  });
});
