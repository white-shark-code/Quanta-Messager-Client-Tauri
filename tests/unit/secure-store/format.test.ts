import { describe, expect, it } from "vitest";

import { decrypt } from "@/features/secure-store/cipher";
import { MAGIC, VERSION, parse, serialize } from "@/features/secure-store/format";
import type { KeystorePayload } from "@/features/secure-store/types";

function fixedBytes(len: number, seed: number): Uint8Array {
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    buf[i] = (seed + i * 19) & 0xff;
  }
  return buf;
}

const FIXED_KEY = fixedBytes(32, 11);
const FIXED_SALT = fixedBytes(16, 23);

const SAMPLE_PAYLOAD: KeystorePayload = {
  version: 1,
  user: { id: "user-uuid-1234", email: "alice@example.com" },
  accessToken: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
  privateKeyArmored:
    "-----BEGIN PGP PRIVATE KEY BLOCK-----\n...fake-armor...\n-----END PGP PRIVATE KEY BLOCK-----",
  publicKeyArmored:
    "-----BEGIN PGP PUBLIC KEY BLOCK-----\n...fake-armor...\n-----END PGP PUBLIC KEY BLOCK-----",
  fingerprint: "ABCD1234DEADBEEF5678EF90",
};

describe("format (keystore.qks binary layout)", () => {
  it("serializes and parses a round-trip preserving kdfSalt, chachaNonce and ciphertext", async () => {
    const buf = await serialize(SAMPLE_PAYLOAD, FIXED_KEY, FIXED_SALT);

    const parsed = parse(buf);

    expect(parsed.kdfSalt).toEqual(FIXED_SALT);
    expect(parsed.chachaNonce.length).toBe(12);
    expect(parsed.ciphertext.length).toBeGreaterThan(0);

    const recovered = decrypt(parsed.ciphertext, FIXED_KEY, parsed.chachaNonce);
    const decoded = JSON.parse(new TextDecoder().decode(recovered)) as KeystorePayload;
    expect(decoded).toEqual(SAMPLE_PAYLOAD);
  });

  it("parse throws when the magic bytes are wrong", async () => {
    const buf = await serialize(SAMPLE_PAYLOAD, FIXED_KEY, FIXED_SALT);
    const corrupted = new Uint8Array(buf);
    corrupted[0] = 0x00;
    corrupted[1] = 0x00;
    corrupted[2] = 0x00;
    corrupted[3] = 0x00;

    expect(() => parse(corrupted)).toThrow(/magic/i);
  });

  it("parse throws when the version byte is wrong", async () => {
    const buf = await serialize(SAMPLE_PAYLOAD, FIXED_KEY, FIXED_SALT);
    const corrupted = new Uint8Array(buf);
    corrupted[4] = 0x99;

    expect(() => parse(corrupted)).toThrow(/version/i);
  });

  it("parses buffers shorter than the header as too-short", () => {
    const tiny = new Uint8Array(10);
    expect(() => parse(tiny)).toThrow(/too short/i);
  });

  it("places magic (4), version (1), flags (1), kdfSalt (16), nonce (12) and ciphertext (N+16) at exact offsets", async () => {
    const plaintextBytes = new TextEncoder().encode(JSON.stringify(SAMPLE_PAYLOAD));
    const buf = await serialize(SAMPLE_PAYLOAD, FIXED_KEY, FIXED_SALT);

    expect(buf.length).toBe(4 + 1 + 1 + 16 + 12 + plaintextBytes.length + 16);

    const magicSlice = buf.slice(0, 4);
    expect(magicSlice).toEqual(MAGIC);

    expect(buf[4]).toBe(VERSION);
    expect(buf[5]).toBe(0x00);

    const saltSlice = buf.slice(6, 22);
    expect(saltSlice).toEqual(FIXED_SALT);

    const nonceSlice = buf.slice(22, 34);
    expect(nonceSlice.length).toBe(12);

    const ciphertextSlice = buf.slice(34);
    expect(ciphertextSlice.length).toBe(plaintextBytes.length + 16);
  });

  it("serialize rejects kdfSalt whose length is not exactly 16 bytes", async () => {
    await expect(serialize(SAMPLE_PAYLOAD, FIXED_KEY, new Uint8Array(8))).rejects.toThrow(/16 bytes/);
  });
});
