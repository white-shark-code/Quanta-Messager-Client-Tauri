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
    if (!buf) {
      return Promise.reject(new Error(`File not found: ${key}`));
    }
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

  // Production code calls mkdir before the first writeFile to ensure
  // the keystores/ directory exists on a clean device. The mock just
  // resolves — the in-memory Map doesn't need directories.
  const mkdir = vi.fn((): Promise<void> => Promise.resolve());

  return {
    BaseDirectory,
    readFile,
    writeFile,
    exists,
    remove,
    mkdir,
  };
});

vi.mock("@tauri-apps/api/path", () => ({
  // The production deleteKeystoreFile joins appDataDir() with the
  // relative keystore path. The mock returns a deterministic value for
  // appDataDir() and a join() that strips the first arg so the resulting
  // absolute key still resolves to the in-memory map entry written by
  // the writeFile mock (which stores under the relative path).
  appDataDir: vi.fn((): Promise<string> => Promise.resolve("/mock-appdata")),
  join: vi.fn((...args: string[]): Promise<string> => Promise.resolve(args.slice(1).join("/"))),
}));

import {
  readFile as mockedReadFile,
  writeFile as mockedWriteFile,
  exists as mockedExists,
} from "@tauri-apps/plugin-fs";
import {
  deleteKeystore,
  readKeystore,
  updateKeystoreToken,
  writeKeystore,
  getKeystorePath,
} from "@/features/secure-store/store";
import { hasKeystore } from "@/infra/tauriBridge";
import { generateKeyPair, importPrivateKey } from "@/features/keyring/encrypt";
import type { KeystorePayload } from "@/features/secure-store/types";

const { FAST_KDF_PARAMS } = vi.hoisted(() => ({
  FAST_KDF_PARAMS: { memoryKiB: 1024, iterations: 1, parallelism: 1 },
}));

vi.mock("@/features/secure-store/kdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/secure-store/kdf")>();
  return {
    ...actual,
    deriveKey: vi.fn((passphrase: string, params: { salt: Uint8Array }): Promise<Uint8Array> => {
      const salt = params.salt;
      const key = new Uint8Array(32);
      const len = Math.max(passphrase.length, 1);
      for (let i = 0; i < 32; i++) {
        key[i] = ((passphrase.charCodeAt(i % len) ?? 0) ^ (salt[i % salt.length] ?? 0)) & 0xff;
      }
      return Promise.resolve(key);
    }),
    DEFAULT_KDF_PARAMS: {
      ...actual.DEFAULT_KDF_PARAMS,
      ...FAST_KDF_PARAMS,
    },
  };
});

const USER_A = "user-aaa-111";
const USER_B = "user-bbb-222";

const SAMPLE_PAYLOAD_A: KeystorePayload = {
  version: 1,
  user: { id: USER_A, email: "alice@example.com" },
  accessToken: "tok-aaa",
  privateKeyArmored:
    "-----BEGIN PGP PRIVATE KEY BLOCK-----\nfakeA\n-----END PGP PRIVATE KEY BLOCK-----",
  publicKeyArmored:
    "-----BEGIN PGP PUBLIC KEY BLOCK-----\nfakeA\n-----END PGP PUBLIC KEY BLOCK-----",
  fingerprint: "FINGERPRINT_A",
  dialogKey: "AAECAwQFBgcICQoLDA0ODw==",
};

const SAMPLE_PAYLOAD_B: KeystorePayload = {
  version: 1,
  user: { id: USER_B, email: "bob@example.com" },
  accessToken: "tok-bbb",
  privateKeyArmored:
    "-----BEGIN PGP PRIVATE KEY BLOCK-----\nfakeB\n-----END PGP PRIVATE KEY BLOCK-----",
  publicKeyArmored:
    "-----BEGIN PGP PUBLIC KEY BLOCK-----\nfakeB\n-----END PGP PUBLIC KEY BLOCK-----",
  fingerprint: "FINGERPRINT_B",
  dialogKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxw=",
};

/**
 * `isTauri()` in `tauriBridge.ts` checks `typeof window !== "undefined" && "__TAURI_INTERNALS__" in window`.
 * In Vitest's node environment neither is true, so the bridge falls back to
 * `localStorage` (also undefined). Force the Tauri path so the mock at
 * `@tauri-apps/plugin-fs` actually receives calls.
 */
function forceTauriRuntime(): void {
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

beforeEach(() => {
  fsState.files.clear();
  vi.clearAllMocks();
  forceTauriRuntime();
});

afterEach(() => {
  fsState.files.clear();
});

describe("store (writeKeystore / readKeystore)", () => {
  it("round-trips a payload: writeKeystore then readKeystore returns identical data", async () => {
    await writeKeystore(USER_A, SAMPLE_PAYLOAD_A, "correct");
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    expect(fsState.files.has(getKeystorePath(USER_A))).toBe(true);

    const recovered = await readKeystore(USER_A, "correct");
    expect(recovered).toEqual(SAMPLE_PAYLOAD_A);
    expect(mockedReadFile).toHaveBeenCalled();
  });

  it("round-trips a payload with an empty passphrase", async () => {
    await writeKeystore(USER_A, SAMPLE_PAYLOAD_A, "");

    const recovered = await readKeystore(USER_A, "");

    expect(recovered).toEqual(SAMPLE_PAYLOAD_A);
  });

  it("round-trips a generated unencrypted key through the keystore", async () => {
    const pair = await generateKeyPair(
      { name: "Empty Passphrase User", email: "empty-passphrase@test.local" },
      "",
      "ecc",
    );
    const payload = {
      ...SAMPLE_PAYLOAD_A,
      privateKeyArmored: pair.privateKeyArmored,
      publicKeyArmored: pair.publicKeyArmored,
      fingerprint: pair.fingerprint,
    };

    await writeKeystore(USER_A, payload, "");
    const recovered = await readKeystore(USER_A, "");
    const privateKey = await importPrivateKey(recovered.privateKeyArmored, "");

    expect(recovered).toEqual(payload);
    expect(privateKey.isDecrypted()).toBe(true);
  });

  it("readKeystore throws when called with the wrong password", async () => {
    await writeKeystore(USER_A, SAMPLE_PAYLOAD_A, "correct");
    await expect(readKeystore(USER_A, "wrong")).rejects.toThrow(/Wrong password or corrupted file/);
  });

  it("readKeystore throws when the file exists but is truncated / corrupted", async () => {
    fsState.files.set(
      getKeystorePath(USER_A),
      new Uint8Array([0x51, 0x4b, 0x53, 0x31, 0x01, 0x00]),
    );

    await expect(readKeystore(USER_A, "anything")).rejects.toThrow();
  });

  it("readKeystore throws when the file does not exist", async () => {
    expect(fsState.files.has(getKeystorePath(USER_A))).toBe(false);
    expect(await mockedExists(getKeystorePath(USER_A))).toBe(false);

    await expect(readKeystore(USER_A, "anything")).rejects.toThrow();
  });

  it("scopes ciphertext per userId: two users, two passphrases, two isolated stores", async () => {
    await writeKeystore(USER_A, SAMPLE_PAYLOAD_A, "passA");
    await writeKeystore(USER_B, SAMPLE_PAYLOAD_B, "passB");

    expect(fsState.files.has(getKeystorePath(USER_A))).toBe(true);
    expect(fsState.files.has(getKeystorePath(USER_B))).toBe(true);
    expect(getKeystorePath(USER_A)).not.toBe(getKeystorePath(USER_B));

    const backA = await readKeystore(USER_A, "passA");
    const backB = await readKeystore(USER_B, "passB");
    expect(backA).toEqual(SAMPLE_PAYLOAD_A);
    expect(backB).toEqual(SAMPLE_PAYLOAD_B);

    expect(await hasKeystore(USER_A)).toBe(true);
    expect(await hasKeystore(USER_B)).toBe(true);
  });

  it("hasKeystore returns true for a user that wrote a keystore and false for a user that did not", async () => {
    expect(await hasKeystore(USER_A)).toBe(false);
    expect(await hasKeystore(USER_B)).toBe(false);

    await writeKeystore(USER_A, SAMPLE_PAYLOAD_A, "passA");

    expect(await hasKeystore(USER_A)).toBe(true);
    expect(await hasKeystore(USER_B)).toBe(false);
  });

  it("deleteKeystore removes only the targeted user's file", async () => {
    await writeKeystore(USER_A, SAMPLE_PAYLOAD_A, "passA");
    await writeKeystore(USER_B, SAMPLE_PAYLOAD_B, "passB");

    await deleteKeystore(USER_A);

    expect(await hasKeystore(USER_A)).toBe(false);
    expect(await hasKeystore(USER_B)).toBe(true);
    expect(fsState.files.has(getKeystorePath(USER_B))).toBe(true);
  });

  it("updateKeystoreToken re-encrypts a single user's keystore without disturbing the other user", async () => {
    await writeKeystore(USER_A, SAMPLE_PAYLOAD_A, "passA");
    await writeKeystore(USER_B, SAMPLE_PAYLOAD_B, "passB");

    const updated = await updateKeystoreToken(USER_A, "passA", "rotated-token");

    expect(updated.accessToken).toBe("rotated-token");
    expect(updated.user).toEqual(SAMPLE_PAYLOAD_A.user);

    const backA = await readKeystore(USER_A, "passA");
    const backB = await readKeystore(USER_B, "passB");

    expect(backA.accessToken).toBe("rotated-token");
    expect(backA.fingerprint).toBe(SAMPLE_PAYLOAD_A.fingerprint);
    expect(backB).toEqual(SAMPLE_PAYLOAD_B);
  });
});
