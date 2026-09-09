import { describe, expect, it } from "vitest";

import { DEFAULT_KDF_PARAMS, deriveKey, generateSalt } from "@/features/secure-store/kdf";

function fixedSalt(seed: number): Uint8Array {
  const salt = new Uint8Array(16);
  for (let i = 0; i < salt.length; i++) {
    salt[i] = (seed + i * 5) & 0xff;
  }
  return salt;
}

const FAST_PARAMS = {
  memoryKiB: 1024,
  iterations: 1,
  parallelism: 1,
  salt: fixedSalt(1),
};

describe("kdf (Argon2id)", () => {
  it("derives the same key for the same passphrase + same salt", async () => {
    const k1 = await deriveKey("correct horse battery staple", { ...FAST_PARAMS, salt: fixedSalt(42) });
    const k2 = await deriveKey("correct horse battery staple", { ...FAST_PARAMS, salt: fixedSalt(42) });

    expect(k1).toEqual(k2);
  });

  it("derives a 32-byte key for an empty passphrase", async () => {
    const k1 = await deriveKey("", { ...FAST_PARAMS, salt: fixedSalt(17) });
    const k2 = await deriveKey("", { ...FAST_PARAMS, salt: fixedSalt(17) });

    expect(k1).toEqual(k2);
    expect(k1).toHaveLength(32);
  });

  it("derives a different key for different salts (same passphrase)", async () => {
    const k1 = await deriveKey("same-passphrase", { ...FAST_PARAMS, salt: fixedSalt(1) });
    const k2 = await deriveKey("same-passphrase", { ...FAST_PARAMS, salt: fixedSalt(2) });

    expect(k1).not.toEqual(k2);
  });

  it("derives a different key for different passphrases (same salt)", async () => {
    const k1 = await deriveKey("passphrase-A", { ...FAST_PARAMS, salt: fixedSalt(99) });
    const k2 = await deriveKey("passphrase-B", { ...FAST_PARAMS, salt: fixedSalt(99) });

    expect(k1).not.toEqual(k2);
  });

  it("always returns a key of exactly 32 bytes", async () => {
    const k = await deriveKey("length-check", { ...FAST_PARAMS, salt: fixedSalt(7) });
    expect(k).toBeInstanceOf(Uint8Array);
    expect(k.length).toBe(32);
  });

  it("generateSalt returns 16 bytes of random data, different on each call", () => {
    const s1 = generateSalt();
    const s2 = generateSalt();

    expect(s1).toBeInstanceOf(Uint8Array);
    expect(s1.length).toBe(16);
    expect(s2.length).toBe(16);
    expect(s1).not.toEqual(s2);
  });

  it("uses default KDF params with sane fallback values", () => {
    expect(DEFAULT_KDF_PARAMS.iterations).toBeGreaterThan(0);
    expect(DEFAULT_KDF_PARAMS.memoryKiB).toBeGreaterThan(0);
    expect(DEFAULT_KDF_PARAMS.parallelism).toBeGreaterThan(0);
    expect(DEFAULT_KDF_PARAMS.salt.length).toBe(16);
  });
});
