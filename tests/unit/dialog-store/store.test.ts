import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => {
  const files = new Map<string, Uint8Array>();
  return { files };
});

vi.mock("@tauri-apps/plugin-fs", () => {
  const BaseDirectory = { AppData: 0 };

  const readFile = vi.fn(async (path: string | URL): Promise<Uint8Array<ArrayBuffer>> => {
    const key = typeof path === "string" ? path : path.toString();
    const buf = fsState.files.get(key);
    if (!buf) throw new Error(`File not found: ${key}`);
    return new Uint8Array(buf);
  });

  const writeFile = vi.fn(
    async (path: string | URL, data: Uint8Array | ReadableStream<Uint8Array>): Promise<void> => {
      const key = typeof path === "string" ? path : path.toString();
      if (data instanceof Uint8Array) fsState.files.set(key, new Uint8Array(data));
      else throw new Error("ReadableStream is not supported by the in-memory mock");
    },
  );

  const exists = vi.fn(async (path: string | URL): Promise<boolean> => {
    const key = typeof path === "string" ? path : path.toString();
    return fsState.files.has(key);
  });

  const remove = vi.fn(async (path: string | URL): Promise<void> => {
    const key = typeof path === "string" ? path : path.toString();
    fsState.files.delete(key);
  });

  const mkdir = vi.fn(async (_path: string | URL): Promise<void> => undefined);

  return { BaseDirectory, readFile, writeFile, exists, remove, mkdir };
});

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async (): Promise<string> => "/mock-appdata"),
  join: vi.fn(async (_base: string, ...rest: string[]): Promise<string> => rest.join("/")),
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
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return btoa(s);
}

function setKeyringKey(seed: number): void {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (seed + i * 7) & 0xff;
  useKeyringStore.setState({ dialogKeyB64: b64(bytes) });
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
    expect((await listDialogs(USER))).not.toContain(CHAT_A);
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
