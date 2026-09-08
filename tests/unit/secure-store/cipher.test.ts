import { describe, expect, it } from "vitest";

import { decrypt, encrypt } from "@/features/secure-store/cipher";

function makeKey(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  for (let i = 0; i < key.length; i++) {
    key[i] = (seed + i * 7) & 0xff;
  }
  return key;
}

function makeNonce(seed: number): Uint8Array {
  const nonce = new Uint8Array(12);
  for (let i = 0; i < nonce.length; i++) {
    nonce[i] = (seed * 13 + i * 11) & 0xff;
  }
  return nonce;
}

function makePlaintext(size: number, seed: number): Uint8Array {
  const pt = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    pt[i] = (seed * 31 + i * 17) & 0xff;
  }
  return pt;
}

describe("cipher (ChaCha20-Poly1305)", () => {
  it("encrypts and decrypts a 100-byte round-trip back to identical plaintext", () => {
    const key = makeKey(1);
    const nonce = makeNonce(2);
    const plaintext = makePlaintext(100, 3);

    const ciphertext = encrypt(plaintext, key, nonce);

    expect(ciphertext.length).toBe(plaintext.length + 16);
    expect(ciphertext).not.toEqual(plaintext);

    const recovered = decrypt(ciphertext, key, nonce);
    expect(recovered).toEqual(plaintext);
  });

  it("throws when ciphertext bytes are tampered", () => {
    const key = makeKey(4);
    const nonce = makeNonce(5);
    const plaintext = makePlaintext(64, 6);

    const ciphertext = encrypt(plaintext, key, nonce);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0x01;

    expect(() => decrypt(ciphertext, key, nonce)).toThrow();
  });

  it("throws when the Poly1305 tag (last 16 bytes) is tampered", () => {
    const key = makeKey(7);
    const nonce = makeNonce(8);
    const plaintext = makePlaintext(64, 9);

    const ciphertext = encrypt(plaintext, key, nonce);
    const last = ciphertext.length - 1;
    ciphertext[last] = (ciphertext[last] ?? 0) ^ 0xff;

    expect(() => decrypt(ciphertext, key, nonce)).toThrow();
  });

  it("throws when the wrong nonce is used for decryption", () => {
    const key = makeKey(10);
    const nonce = makeNonce(11);
    const wrongNonce = makeNonce(12);
    const plaintext = makePlaintext(48, 13);

    const ciphertext = encrypt(plaintext, key, nonce);

    expect(() => decrypt(ciphertext, key, wrongNonce)).toThrow();
  });

  it("round-trips an empty plaintext", () => {
    const key = makeKey(14);
    const nonce = makeNonce(15);
    const plaintext = new Uint8Array(0);

    const ciphertext = encrypt(plaintext, key, nonce);
    expect(ciphertext.length).toBe(16);

    const recovered = decrypt(ciphertext, key, nonce);
    expect(recovered.length).toBe(0);
    expect(recovered).toEqual(plaintext);
  });
});
