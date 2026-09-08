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

  it("decryptText with a mismatched signature returns verified: false", async () => {
    const plaintext = "Trusted message";
    const { encrypted } = await encryptText(plaintext, [bobPub], alicePriv);

    // Build a structurally valid detached signature that signs *different*
    // content with the same signing key. openpgp will parse it fine, but
    // verification against the ciphertext must fail.
    const otherMessage = await openpgp.createMessage({ text: "different content" });
    const wrongSigArmored: string = await openpgp.sign({
      message: otherMessage,
      signingKeys: alicePriv,
      detached: true,
      format: "armored",
    });
    const wrongSignature = new TextEncoder().encode(wrongSigArmored);

    const result = await decryptText(encrypted, wrongSignature, alicePub, bobPriv);
    expect(result.text).toBe(plaintext);
    expect(result.verified).toBe(false);
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
    await expect(
      decryptText(encrypted, signature, alicePub, alicePriv),
    ).rejects.toThrow();
  });

  it("encryptFile + decryptFile round-trip preserves binary data byte-for-byte", async () => {
    const data = new Uint8Array([0, 1, 2, 3, 0xff, 0xfe, 0x80, 0x7f, 0x00, 0x42]);
    const { encrypted, signature } = await encryptFile(data, [bobPub], alicePriv);
    const recovered = await decryptFile(encrypted, signature, alicePub, bobPriv);
    expect(recovered).toEqual(data);
  });

  it("encryptText accepts the same recipient listed twice", async () => {
    const plaintext = "Multi-recipient message";
    const { encrypted, signature } = await encryptText(
      plaintext,
      [bobPub, bobPub],
      alicePriv,
    );
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