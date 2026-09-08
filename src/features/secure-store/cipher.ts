import { ChaCha20Poly1305 } from "@stablelib/chacha20poly1305";

export function encrypt(plaintext: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array {
  const cipher = new ChaCha20Poly1305(key);
  return cipher.seal(nonce, plaintext);
}

export function decrypt(ciphertext: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array {
  const cipher = new ChaCha20Poly1305(key);
  const plaintext = cipher.open(nonce, ciphertext);
  if (plaintext === null) {
    throw new Error("Wrong password or corrupted file");
  }
  return plaintext;
}
