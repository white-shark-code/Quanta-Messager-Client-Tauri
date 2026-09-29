import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, Uint8Array>());
const indexState = vi.hoisted(() => ({
  bytes: new Uint8Array(0),
  nextWriteError: null as Error | null,
  nextReadError: null as Error | null,
}));

vi.mock("@/infra/tauriBridge", () => {
  return {
    readKeystoreBuffer: vi.fn(async (userId: string): Promise<Uint8Array> => {
      const v = storage.get(`keystore-${userId}`);
      if (!v) {
        throw new Error(`Keystore not found for user ${userId}`);
      }
      return new Uint8Array(v);
    }),
    writeKeystoreBuffer: vi.fn(async (userId: string, data: Uint8Array): Promise<void> => {
      storage.set(`keystore-${userId}`, new Uint8Array(data));
    }),
    hasKeystore: vi.fn(async (userId: string): Promise<boolean> => {
      return storage.has(`keystore-${userId}`);
    }),
    deleteKeystoreFile: vi.fn(async (userId: string): Promise<void> => {
      storage.delete(`keystore-${userId}`);
    }),
    readIndexBuffer: vi.fn(async (): Promise<Uint8Array> => {
      if (indexState.nextReadError) {
        const e = indexState.nextReadError;
        indexState.nextReadError = null;
        throw e;
      }
      return new Uint8Array(indexState.bytes);
    }),
    writeIndexBuffer: vi.fn(async (data: Uint8Array): Promise<void> => {
      if (indexState.nextWriteError) {
        const e = indexState.nextWriteError;
        indexState.nextWriteError = null;
        throw e;
      }
      indexState.bytes = new Uint8Array(data);
    }),
  };
});

import {
  deleteKeystore,
  readIndex,
  readKeystore,
  removeIndexEntry,
  upsertIndexEntry,
  updateKeystoreToken,
  writeKeystore,
} from "@/features/secure-store/store";
import { hasKeystore } from "@/infra/tauriBridge";
import { decrypt, encrypt } from "@/features/secure-store/cipher";
import { parse, serialize } from "@/features/secure-store/format";
import type { KeystorePayload } from "@/features/secure-store/types";

const { FAST_KDF_PARAMS } = vi.hoisted(() => ({
  FAST_KDF_PARAMS: { memoryKiB: 1024, iterations: 1, parallelism: 1 },
}));

vi.mock("@/features/secure-store/kdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/secure-store/kdf")>();
  return {
    ...actual,
    deriveKey: vi.fn(async (passphrase: string, params: { salt: Uint8Array }): Promise<Uint8Array> => {
      const salt = params.salt;
      const key = new Uint8Array(32);
      const len = Math.max(passphrase.length, 1);
      for (let i = 0; i < 32; i++) {
        key[i] = ((passphrase.charCodeAt(i % len) ?? 0) ^ (salt[i % salt.length] ?? 0)) & 0xff;
      }
      return key;
    }),
    DEFAULT_KDF_PARAMS: {
      ...actual.DEFAULT_KDF_PARAMS,
      ...FAST_KDF_PARAMS,
    },
  };
});

const USER_A = "user-aaa-111";
const USER_B = "user-bbb-222";

function makePayload(userId: string, email: string, token: string): KeystorePayload {
  return {
    version: 1,
    user: { id: userId, email },
    accessToken: token,
    privateKeyArmored: `-----BEGIN PGP PRIVATE KEY BLOCK-----\n${email}\n-----END PGP PRIVATE KEY BLOCK-----`,
    publicKeyArmored: `-----BEGIN PGP PUBLIC KEY BLOCK-----\n${email}\n-----END PGP PUBLIC KEY BLOCK-----`,
    fingerprint: `FP-${userId}`,
    dialogKey: "AAECAwQFBgcICQoLDA0ODw==",
  };
}

beforeEach(() => {
  storage.clear();
  indexState.bytes = new Uint8Array(0);
  indexState.nextReadError = null;
  indexState.nextWriteError = null;
  vi.clearAllMocks();
});

afterEach(() => {
  storage.clear();
  indexState.bytes = new Uint8Array(0);
});

describe("secure-store multi-user — end-to-end isolation", () => {
  it("UserA and UserB write independent keystores and each can read back only their own", async () => {
    const payloadA = makePayload(USER_A, "alice@example.com", "tok-aaa");
    const payloadB = makePayload(USER_B, "bob@example.com", "tok-bbb");

    await writeKeystore(USER_A, payloadA, "passA");
    await writeKeystore(USER_B, payloadB, "passB");

    expect(await hasKeystore(USER_A)).toBe(true);
    expect(await hasKeystore(USER_B)).toBe(true);
    expect(storage.has(`keystore-${USER_A}`)).toBe(true);
    expect(storage.has(`keystore-${USER_B}`)).toBe(true);
    expect(storage.get(`keystore-${USER_A}`)).not.toEqual(storage.get(`keystore-${USER_B}`));

    const backA = await readKeystore(USER_A, "passA");
    const backB = await readKeystore(USER_B, "passB");
    expect(backA).toEqual(payloadA);
    expect(backB).toEqual(payloadB);

    await expect(readKeystore(USER_A, "passB")).rejects.toThrow();
    await expect(readKeystore(USER_B, "passA")).rejects.toThrow();
  });

  it("UserA erase leaves UserB's keystore intact and updates hasKeystore per user", async () => {
    await writeKeystore(USER_A, makePayload(USER_A, "alice@example.com", "tok-aaa"), "passA");
    await writeKeystore(USER_B, makePayload(USER_B, "bob@example.com", "tok-bbb"), "passB");

    expect(await hasKeystore(USER_A)).toBe(true);
    expect(await hasKeystore(USER_B)).toBe(true);

    await deleteKeystore(USER_A);

    expect(await hasKeystore(USER_A)).toBe(false);
    expect(await hasKeystore(USER_B)).toBe(true);
    expect(storage.has(`keystore-${USER_B}`)).toBe(true);

    const backB = await readKeystore(USER_B, "passB");
    expect(backB.accessToken).toBe("tok-bbb");

    await expect(readKeystore(USER_A, "passA")).rejects.toThrow();
  });

  it("updateKeystoreToken on UserA does not touch UserB's ciphertext or plaintext", async () => {
    await writeKeystore(USER_A, makePayload(USER_A, "alice@example.com", "tok-aaa"), "passA");
    await writeKeystore(USER_B, makePayload(USER_B, "bob@example.com", "tok-bbb"), "passB");

    const beforeB = storage.get(`keystore-${USER_B}`);
    expect(beforeB).toBeDefined();

    const updated = await updateKeystoreToken(USER_A, "passA", "rotated-aaa");
    expect(updated.accessToken).toBe("rotated-aaa");
    expect(updated.user).toEqual({ id: USER_A, email: "alice@example.com" });

    const afterB = storage.get(`keystore-${USER_B}`);
    expect(afterB).toEqual(beforeB);

    const backB = await readKeystore(USER_B, "passB");
    expect(backB.accessToken).toBe("tok-bbb");
    expect(backB.user).toEqual({ id: USER_B, email: "bob@example.com" });

    const backA = await readKeystore(USER_A, "passA");
    expect(backA.accessToken).toBe("rotated-aaa");
  });

  it("the index file is shared but entries are scoped per userId", async () => {
    await upsertIndexEntry({
      userId: USER_A,
      email: "alice@example.com",
      lastUsedAt: "2026-05-01T10:00:00.000Z",
    });
    await upsertIndexEntry({
      userId: USER_B,
      email: "bob@example.com",
      lastUsedAt: "2026-05-01T10:05:00.000Z",
    });

    const idx = await readIndex();
    expect(idx.users).toHaveLength(2);
    expect(idx.users.map((u) => u.userId).sort()).toEqual([USER_A, USER_B].sort());

    await removeIndexEntry(USER_A);

    const idx2 = await readIndex();
    expect(idx2.users).toHaveLength(1);
    expect(idx2.users[0]?.userId).toBe(USER_B);
  });
});

describe("secure-store multi-user — format round-trip (ChaCha20-Poly1305)", () => {
  it("writeKeystore → readKeystore encrypts with a per-write nonce and decrypts back identically", async () => {
    const payload = makePayload(USER_A, "alice@example.com", "tok-aaa");
    await writeKeystore(USER_A, payload, "correct");

    const stored = storage.get(`keystore-${USER_A}`);
    expect(stored).toBeDefined();

    const parsed = parse(stored as Uint8Array);
    expect(parsed.ciphertext.length).toBeGreaterThan(0);

    expect(encrypt).toBeDefined();
    expect(decrypt).toBeDefined();

    const recovered = await readKeystore(USER_A, "correct");
    expect(recovered).toEqual(payload);
  });
});
