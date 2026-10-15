import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readIndexBufferMock, writeIndexBufferMock, hasKeystoreMock } = vi.hoisted(() => ({
  readIndexBufferMock: vi.fn(),
  writeIndexBufferMock: vi.fn(),
  hasKeystoreMock: vi.fn(),
}));

vi.mock("@/infra/tauriBridge", () => {
  return {
    readIndexBuffer: (...args: unknown[]): unknown => readIndexBufferMock(...args) as unknown,
    writeIndexBuffer: (...args: unknown[]): unknown => writeIndexBufferMock(...args) as unknown,
    readKeystoreBuffer: vi.fn(),
    writeKeystoreBuffer: vi.fn(),
    hasKeystore: (...args: unknown[]): unknown => hasKeystoreMock(...args) as unknown,
    deleteKeystoreFile: vi.fn(),
  };
});

import {
  getLastUserId,
  readIndex,
  writeIndex,
  upsertIndexEntry,
  removeIndexEntry,
  KEYSTORE_INDEX_PATH,
} from "@/features/secure-store/store";
import type { KeystoreIndex, KeystoreIndexEntry } from "@/features/secure-store/types";

const TEXT_DECODER = new TextDecoder();

function bytesFromIndex(idx: KeystoreIndex): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(idx));
}

beforeEach(() => {
  readIndexBufferMock.mockReset();
  writeIndexBufferMock.mockReset();
  writeIndexBufferMock.mockResolvedValue(undefined);
  hasKeystoreMock.mockReset();
  hasKeystoreMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("secure-store/index — readIndex", () => {
  it("returns {users: []} when readIndexBuffer rejects (file missing)", async () => {
    readIndexBufferMock.mockRejectedValueOnce(new Error("ENOENT: no such file"));
    await expect(readIndex()).resolves.toEqual({ users: [] });
  });

  it("returns {users: []} when the buffer is empty (zero bytes — first run)", async () => {
    readIndexBufferMock.mockResolvedValueOnce(new Uint8Array(0));
    await expect(readIndex()).resolves.toEqual({ users: [] });
  });

  it("returns {users: []} when the buffer contains invalid JSON (defensive)", async () => {
    readIndexBufferMock.mockResolvedValueOnce(new TextEncoder().encode("{not-valid-json"));
    await expect(readIndex()).resolves.toEqual({ users: [] });
  });

  it("returns the parsed index when the buffer contains valid JSON", async () => {
    const idx: KeystoreIndex = {
      users: [
        { userId: "u-1", email: "alice@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" },
        { userId: "u-2", email: "bob@example.com", lastUsedAt: "2026-01-02T00:00:00.000Z" },
      ],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(idx));

    await expect(readIndex()).resolves.toEqual(idx);
  });

  it("returns {users: []} when 'users' field is not an array (defensive against schema drift)", async () => {
    readIndexBufferMock.mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify({ users: "nope" })),
    );
    await expect(readIndex()).resolves.toEqual({ users: [] });
  });
});

describe("secure-store/index — writeIndex", () => {
  it("calls writeIndexBuffer with JSON.stringify of the index", async () => {
    const idx: KeystoreIndex = {
      users: [
        { userId: "u-1", email: "alice@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" },
      ],
    };
    await writeIndex(idx);

    expect(writeIndexBufferMock).toHaveBeenCalledTimes(1);
    const arg = writeIndexBufferMock.mock.calls[0]?.[0] as Uint8Array;
    expect(arg).toBeInstanceOf(Uint8Array);

    const round = JSON.parse(TEXT_DECODER.decode(arg)) as KeystoreIndex;
    expect(round).toEqual(idx);
  });

  it("serializes an empty index without errors", async () => {
    await writeIndex({ users: [] });
    expect(writeIndexBufferMock).toHaveBeenCalledTimes(1);
    const arg = writeIndexBufferMock.mock.calls[0]?.[0] as Uint8Array;
    expect(JSON.parse(TEXT_DECODER.decode(arg))).toEqual({ users: [] });
  });
});

describe("secure-store/index — upsertIndexEntry", () => {
  it("appends a new entry to an empty index", async () => {
    readIndexBufferMock.mockResolvedValueOnce(new Uint8Array(0));

    const entry: KeystoreIndexEntry = {
      userId: "user-new-1",
      email: "new@example.com",
      lastUsedAt: "2026-03-15T10:00:00.000Z",
    };
    await upsertIndexEntry(entry);

    expect(readIndexBufferMock).toHaveBeenCalledTimes(1);
    expect(writeIndexBufferMock).toHaveBeenCalledTimes(1);
    const writtenBytes = writeIndexBufferMock.mock.calls[0]?.[0] as Uint8Array;
    const written = JSON.parse(TEXT_DECODER.decode(writtenBytes)) as KeystoreIndex;
    expect(written.users).toEqual([entry]);
  });

  it("updates an existing entry in place and preserves the order of other users", async () => {
    const initial: KeystoreIndex = {
      users: [
        { userId: "user-1", email: "alice@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" },
        { userId: "user-2", email: "bob@example.com", lastUsedAt: "2026-01-02T00:00:00.000Z" },
        { userId: "user-3", email: "carol@example.com", lastUsedAt: "2026-01-03T00:00:00.000Z" },
      ],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(initial));

    const updated: KeystoreIndexEntry = {
      userId: "user-2",
      email: "bob@example.com",
      lastUsedAt: "2026-04-15T12:34:56.789Z",
    };
    await upsertIndexEntry(updated);

    expect(writeIndexBufferMock).toHaveBeenCalledTimes(1);
    const writtenBytes = writeIndexBufferMock.mock.calls[0]?.[0] as Uint8Array;
    const written = JSON.parse(TEXT_DECODER.decode(writtenBytes)) as KeystoreIndex;

    expect(written.users).toHaveLength(3);
    expect(written.users[0]?.userId).toBe("user-1");
    expect(written.users[1]?.userId).toBe("user-2");
    expect(written.users[2]?.userId).toBe("user-3");
    expect(written.users[1]).toEqual(updated);
  });

  it("appends a brand-new entry to an existing non-empty index at the end (order preserved)", async () => {
    const initial: KeystoreIndex = {
      users: [
        { userId: "user-1", email: "alice@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" },
        { userId: "user-2", email: "bob@example.com", lastUsedAt: "2026-01-02T00:00:00.000Z" },
      ],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(initial));

    const fresh: KeystoreIndexEntry = {
      userId: "user-3",
      email: "carol@example.com",
      lastUsedAt: "2026-05-01T08:00:00.000Z",
    };
    await upsertIndexEntry(fresh);

    const writtenBytes = writeIndexBufferMock.mock.calls[0]?.[0] as Uint8Array;
    const written = JSON.parse(TEXT_DECODER.decode(writtenBytes)) as KeystoreIndex;

    expect(written.users).toHaveLength(3);
    expect(written.users.map((u) => u.userId)).toEqual(["user-1", "user-2", "user-3"]);
    expect(written.users[2]).toEqual(fresh);
  });
});

describe("secure-store/index — removeIndexEntry", () => {
  it("removes the entry with the matching userId and leaves others untouched", async () => {
    const initial: KeystoreIndex = {
      users: [
        { userId: "user-1", email: "alice@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" },
        { userId: "user-2", email: "bob@example.com", lastUsedAt: "2026-01-02T00:00:00.000Z" },
        { userId: "user-3", email: "carol@example.com", lastUsedAt: "2026-01-03T00:00:00.000Z" },
      ],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(initial));

    await removeIndexEntry("user-2");

    expect(writeIndexBufferMock).toHaveBeenCalledTimes(1);
    const writtenBytes = writeIndexBufferMock.mock.calls[0]?.[0] as Uint8Array;
    const written = JSON.parse(TEXT_DECODER.decode(writtenBytes)) as KeystoreIndex;

    expect(written.users).toHaveLength(2);
    expect(written.users.map((u) => u.userId)).toEqual(["user-1", "user-3"]);
  });

  it("is a no-op when the userId is not present (still writes the file)", async () => {
    const initial: KeystoreIndex = {
      users: [
        { userId: "user-1", email: "alice@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" },
      ],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(initial));

    await removeIndexEntry("user-does-not-exist");

    expect(writeIndexBufferMock).toHaveBeenCalledTimes(1);
    const writtenBytes = writeIndexBufferMock.mock.calls[0]?.[0] as Uint8Array;
    const written = JSON.parse(TEXT_DECODER.decode(writtenBytes)) as KeystoreIndex;

    expect(written.users).toEqual(initial.users);
  });
});

describe("secure-store/index — path constants", () => {
  it("exposes KEYSTORE_INDEX_PATH as keystores/index.json (shared index file)", () => {
    expect(KEYSTORE_INDEX_PATH).toBe("keystores/index.json");
  });
});

describe("secure-store/index — getLastUserId", () => {
  it("returns null for an empty index", async () => {
    readIndexBufferMock.mockResolvedValueOnce(new Uint8Array(0));

    await expect(getLastUserId()).resolves.toBeNull();
    expect(hasKeystoreMock).not.toHaveBeenCalled();
  });

  it("returns the id when there is a single user with a keystore", async () => {
    const idx: KeystoreIndex = {
      users: [{ userId: "u-1", email: "a@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" }],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(idx));
    hasKeystoreMock.mockResolvedValueOnce(true);

    await expect(getLastUserId()).resolves.toBe("u-1");
    expect(hasKeystoreMock).toHaveBeenCalledWith("u-1");
  });

  it("returns the freshest user by lastUsedAt", async () => {
    const idx: KeystoreIndex = {
      users: [
        { userId: "u-old", email: "old@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" },
        { userId: "u-new", email: "new@example.com", lastUsedAt: "2026-06-01T00:00:00.000Z" },
        { userId: "u-mid", email: "mid@example.com", lastUsedAt: "2026-03-01T00:00:00.000Z" },
      ],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(idx));

    await expect(getLastUserId()).resolves.toBe("u-new");
    // Freshest candidate is probed first.
    expect(hasKeystoreMock.mock.calls[0]?.[0]).toBe("u-new");
  });

  it("skips entries without a keystore on disk and falls through to the next freshest", async () => {
    const idx: KeystoreIndex = {
      users: [
        { userId: "u-old", email: "old@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" },
        { userId: "u-new", email: "new@example.com", lastUsedAt: "2026-06-01T00:00:00.000Z" },
      ],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(idx));
    hasKeystoreMock.mockImplementation((userId: unknown) => Promise.resolve(userId === "u-old"));

    await expect(getLastUserId()).resolves.toBe("u-old");
  });

  it("returns null when no indexed user has a keystore on disk", async () => {
    const idx: KeystoreIndex = {
      users: [{ userId: "u-1", email: "a@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" }],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(idx));
    hasKeystoreMock.mockResolvedValueOnce(false);

    await expect(getLastUserId()).resolves.toBeNull();
  });

  it("ignores entries with a broken lastUsedAt", async () => {
    const idx: KeystoreIndex = {
      users: [
        { userId: "u-broken", email: "broken@example.com", lastUsedAt: "not-a-date" },
        { userId: "u-good", email: "good@example.com", lastUsedAt: "2026-02-01T00:00:00.000Z" },
      ],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(idx));

    await expect(getLastUserId()).resolves.toBe("u-good");
    expect(hasKeystoreMock).toHaveBeenCalledWith("u-good");
    expect(hasKeystoreMock).not.toHaveBeenCalledWith("u-broken");
  });

  it("returns null when every lastUsedAt is broken", async () => {
    const idx: KeystoreIndex = {
      users: [
        { userId: "u-1", email: "a@example.com", lastUsedAt: "garbage" },
        { userId: "u-2", email: "b@example.com", lastUsedAt: "" },
      ],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(idx));

    await expect(getLastUserId()).resolves.toBeNull();
    expect(hasKeystoreMock).not.toHaveBeenCalled();
  });

  it("returns null (best-effort) when hasKeystore rejects", async () => {
    const idx: KeystoreIndex = {
      users: [{ userId: "u-1", email: "a@example.com", lastUsedAt: "2026-01-01T00:00:00.000Z" }],
    };
    readIndexBufferMock.mockResolvedValueOnce(bytesFromIndex(idx));
    hasKeystoreMock.mockRejectedValueOnce(new Error("disk I/O"));

    await expect(getLastUserId()).resolves.toBeNull();
  });
});
