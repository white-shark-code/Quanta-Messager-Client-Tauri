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
    if (!buf) {
      throw new Error(`File not found: ${key}`);
    }
    return new Uint8Array(buf);
  });

  const writeFile = vi.fn(
    async (path: string | URL, data: Uint8Array | ReadableStream<Uint8Array>): Promise<void> => {
      const key = typeof path === "string" ? path : path.toString();
      if (data instanceof Uint8Array) {
        fsState.files.set(key, new Uint8Array(data));
      } else {
        throw new Error("ReadableStream is not supported by the in-memory mock");
      }
    },
  );

  const exists = vi.fn(async (path: string | URL): Promise<boolean> => {
    const key = typeof path === "string" ? path : path.toString();
    return fsState.files.has(key);
  });

  return {
    BaseDirectory,
    readFile,
    writeFile,
    exists,
  };
});

import { readFile as mockedReadFile, writeFile as mockedWriteFile, exists as mockedExists } from "@tauri-apps/plugin-fs";
import { readKeystore, writeKeystore, KEYSTORE_PATH } from "@/features/secure-store/store";
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
      for (let i = 0; i < 32; i++) {
        key[i] = ((passphrase.charCodeAt(i % passphrase.length) ?? 0) ^ (salt[i % salt.length] ?? 0)) & 0xff;
      }
      return key;
    }),
    DEFAULT_KDF_PARAMS: {
      ...actual.DEFAULT_KDF_PARAMS,
      ...FAST_KDF_PARAMS,
    },
  };
});

const SAMPLE_PAYLOAD: KeystorePayload = {
  version: 1,
  user: { id: "user-abc", email: "bob@example.com" },
  accessToken: "tok-123",
  privateKeyArmored: "-----BEGIN PGP PRIVATE KEY BLOCK-----\nfake\n-----END PGP PRIVATE KEY BLOCK-----",
  publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----",
  fingerprint: "FINGERPRINTXYZ",
};

beforeEach(() => {
  fsState.files.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  fsState.files.clear();
});

describe("store (writeKeystore / readKeystore)", () => {
  it("round-trips a payload: writeKeystore then readKeystore returns identical data", async () => {
    await writeKeystore(SAMPLE_PAYLOAD, "correct");
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    expect(fsState.files.has(KEYSTORE_PATH)).toBe(true);

    const recovered = await readKeystore("correct");
    expect(recovered).toEqual(SAMPLE_PAYLOAD);
    expect(mockedReadFile).toHaveBeenCalled();
  });

  it("readKeystore throws when called with the wrong password", async () => {
    await writeKeystore(SAMPLE_PAYLOAD, "correct");
    await expect(readKeystore("wrong")).rejects.toThrow(/Wrong password or corrupted file/);
  });

  it("readKeystore throws when the file exists but is truncated / corrupted", async () => {
    fsState.files.set(KEYSTORE_PATH, new Uint8Array([0x51, 0x4b, 0x53, 0x31, 0x01, 0x00]));

    await expect(readKeystore("anything")).rejects.toThrow();
  });

  it("readKeystore throws when the file does not exist", async () => {
    expect(fsState.files.has(KEYSTORE_PATH)).toBe(false);
    expect(await mockedExists(KEYSTORE_PATH)).toBe(false);

    await expect(readKeystore("anything")).rejects.toThrow();
  });
});
