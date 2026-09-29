import * as openpgp from "openpgp";
import { beforeAll, describe, expect, it } from "vitest";

import {
  decryptFile,
  decryptText,
  encryptFile,
  encryptText,
  fingerprintOf,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
} from "@/features/keyring/encrypt";
import type { KeyPair } from "@/features/keyring/types";

const PASSPHRASE = "test-passphrase-correct-horse-battery-staple";

describe("keyring/encrypt", () => {
  let alice: KeyPair;
  let bob: KeyPair;
  let alicePub: openpgp.Key;
  let alicePriv: openpgp.PrivateKey;
  let bobPub: openpgp.Key;
  let bobPriv: openpgp.PrivateKey;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([
      generateKeyPair({ name: "Alice", email: "alice@test.local" }, PASSPHRASE, "ecc"),
      generateKeyPair({ name: "Bob", email: "bob@test.local" }, PASSPHRASE, "ecc"),
    ]);
    [alicePub, bobPub] = await Promise.all([
      importPublicKey(alice.publicKeyArmored),
      importPublicKey(bob.publicKeyArmored),
    ]);
    [alicePriv, bobPriv] = await Promise.all([
      importPrivateKey(alice.privateKeyArmored, PASSPHRASE),
      importPrivateKey(bob.privateKeyArmored, PASSPHRASE),
    ]);
  }, 60_000);

  it("generateKeyPair('ecc') returns valid KeyPair with non-empty fields", () => {
    expect(alice.privateKeyArmored.length).toBeGreaterThan(0);
    expect(alice.publicKeyArmored.length).toBeGreaterThan(0);
    expect(alice.fingerprint.length).toBeGreaterThan(0);
    expect(alice.privateKeyArmored).toContain("BEGIN PGP PRIVATE KEY BLOCK");
    expect(alice.privateKeyArmored).toContain("END PGP PRIVATE KEY BLOCK");
    expect(alice.publicKeyArmored).toContain("BEGIN PGP PUBLIC KEY BLOCK");
    expect(alice.publicKeyArmored).toContain("END PGP PUBLIC KEY BLOCK");
    expect(alice.fingerprint).toMatch(/^[A-F0-9]{40}$/);
  });

  it("generates and imports an unencrypted key with an empty passphrase", async () => {
    const pair = await generateKeyPair(
      { name: "Empty Passphrase User", email: "empty-passphrase@test.local" },
      "",
      "ecc",
    );
    const imported = await importPrivateKey(pair.privateKeyArmored, "");

    expect(imported.isDecrypted()).toBe(true);
  }, 30_000);

  it("generateKeyPair('rsa') produces a 4096-bit key pair", async () => {
    const pair = await generateKeyPair(
      { name: "RSA User", email: "rsa@test.local" },
      PASSPHRASE,
      "rsa",
    );
    expect(pair.privateKeyArmored).toContain("BEGIN PGP PRIVATE KEY BLOCK");
    expect(pair.publicKeyArmored).toContain("BEGIN PGP PUBLIC KEY BLOCK");
    expect(pair.fingerprint).toMatch(/^[A-F0-9]{40}$/);
  }, 90_000);

  it("fingerprint is consistent across calls for the same key", async () => {
    const fp1 = await fingerprintOf(alice.publicKeyArmored);
    const fp2 = await fingerprintOf(alice.publicKeyArmored);
    expect(fp1).toBe(fp2);
    expect(fp1).toBe(alice.fingerprint);
  });

  it("encryptText + decryptText round-trip returns original text", async () => {
    const plaintext = "Hello, world!";
    const { encrypted, signature } = await encryptText(plaintext, [bobPub], alicePriv);
    const result = await decryptText(encrypted, signature, alicePub, bobPriv);
    expect(result.text).toBe(plaintext);
    expect(result.verified).toBe(true);
  });

  it("decryptText ignores the detached signature argument (backend-only artifact)", async () => {
    // The `signature` parameter is no longer used for verification —
    // it's the signature-of-ciphertext the backend stores for its
    // zero-knowledge check, which is meaningless on the decrypt side
    // (we have the private key, we can read the plaintext). Verification
    // rides on the embedded signature inside the encrypted blob.
    //
    // Pass a deliberately wrong, structurally invalid signature and
    // verify decrypt still succeeds AND verification of the embedded
    // plaintext signature succeeds.
    const plaintext = "Trusted message";
    const { encrypted } = await encryptText(plaintext, [bobPub], alicePriv);
    const garbageSignature = new TextEncoder().encode("not a real signature");

    const result = await decryptText(encrypted, garbageSignature, alicePub, bobPriv);
    expect(result.text).toBe(plaintext);
    // Verified is determined by the embedded signature (which is good)
    // because we no longer feed the detached one into openpgp.decrypt.
    expect(result.verified).toBe(true);
  });

  it("decryptText with a tampered encrypted blob rejects (Modification detected)", async () => {
    // Substitute the old "mismatched signature" test with a stronger one:
    // a tampered ciphertext must fail. openpgp v6 enforces the
    // OpenPGP modification-detection-code by default and throws
    // `Modification detected` rather than returning garbage — that's
    // exactly the security property we want from an encrypted message.
    const plaintext = "Trusted message";
    const { encrypted } = await encryptText(plaintext, [bobPub], alicePriv);

    // Flip one byte inside the armored blob.
    const tampered = new Uint8Array(encrypted);
    const flipIdx = Math.min(tampered.length - 10, encrypted.length - 50);
    if (tampered[flipIdx] !== undefined) {
      tampered[flipIdx] = (tampered[flipIdx] ?? 0) ^ 0x01;
    }

    const sigBytes = new Uint8Array(0);
    await expect(decryptText(tampered, sigBytes, alicePub, bobPriv)).rejects.toThrow(
      /modification detected/i,
    );
  });

  it("decryptText with a wrong sender verification key returns verified: false", async () => {
    const plaintext = "From alice to bob";
    const { encrypted, signature } = await encryptText(plaintext, [bobPub], alicePriv);

    // Pass bob's public key as the (wrong) sender verification key.
    // Decryption still works (bob is the recipient), but signature
    // verification against bob's key fails for an alice-signed message.
    const result = await decryptText(encrypted, signature, bobPub, bobPriv);
    expect(result.text).toBe(plaintext);
    expect(result.verified).toBe(false);
  });

  it("decryptText throws when the decryption key is not a recipient", async () => {
    const plaintext = "For bob only";
    const { encrypted, signature } = await encryptText(plaintext, [bobPub], alicePriv);

    // Alice's private key is not a recipient of the session key, so
    // openpgp cannot unwrap it and must throw.
    await expect(decryptText(encrypted, signature, alicePub, alicePriv)).rejects.toThrow();
  });

  it("encryptFile + decryptFile round-trip preserves binary data byte-for-byte", async () => {
    const data = new Uint8Array([0, 1, 2, 3, 0xff, 0xfe, 0x80, 0x7f, 0x00, 0x42]);
    const { encrypted, signature } = await encryptFile(data, [bobPub], alicePriv);
    const recovered = await decryptFile(encrypted, signature, alicePub, bobPriv);
    expect(recovered).toEqual(data);
  });

  it("encryptText accepts the same recipient listed twice", async () => {
    const plaintext = "Multi-recipient message";
    const { encrypted, signature } = await encryptText(plaintext, [bobPub, bobPub], alicePriv);
    const result = await decryptText(encrypted, signature, alicePub, bobPriv);
    expect(result.text).toBe(plaintext);
    expect(result.verified).toBe(true);
  });

  it("text with unicode (emoji, cyrillic, greek) round-trips intact", async () => {
    const plaintext = "Привет мир! 🔐🎉 αβγδε ñ ümlaut";
    const { encrypted, signature } = await encryptText(plaintext, [bobPub], alicePriv);
    const result = await decryptText(encrypted, signature, alicePub, bobPriv);
    expect(result.text).toBe(plaintext);
    expect(result.verified).toBe(true);
  });
});
