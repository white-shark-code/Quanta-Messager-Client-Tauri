import { beforeAll, describe, expect, it } from "vitest";

import { isValidArmoredPrivateKey, isValidArmoredPublicKey } from "@/features/keyring/armor";
import { generateKeyPair } from "@/features/keyring/encrypt";
import type { KeyPair } from "@/features/keyring/types";

const PASSPHRASE = "armor-test-passphrase";

describe("keyring/armor", () => {
  let pair: KeyPair;

  beforeAll(async () => {
    pair = await generateKeyPair(
      { name: "Armor Test", email: "armor@test.local" },
      PASSPHRASE,
      "ecc",
    );
  }, 30_000);

  describe("isValidArmoredPublicKey", () => {
    it("returns true for a valid public key", () => {
      expect(isValidArmoredPublicKey(pair.publicKeyArmored)).toBe(true);
    });

    it("returns false for a garbage string", () => {
      expect(isValidArmoredPublicKey("not a pgp key at all")).toBe(false);
      expect(
        isValidArmoredPublicKey(
          "-----BEGIN PGP PUBLIC KEY BLOCK-----\n!@#$%^&*()\n-----END PGP PUBLIC KEY BLOCK-----",
        ),
      ).toBe(false);
    });

    it("returns false for an empty or whitespace-only string", () => {
      expect(isValidArmoredPublicKey("")).toBe(false);
      expect(isValidArmoredPublicKey("   ")).toBe(false);
      expect(isValidArmoredPublicKey("\n\t")).toBe(false);
    });
  });

  describe("isValidArmoredPrivateKey", () => {
    it("returns true with the correct passphrase", async () => {
      expect(await isValidArmoredPrivateKey(pair.privateKeyArmored, PASSPHRASE)).toBe(true);
    });

    it("returns true for an unencrypted key with an empty passphrase", async () => {
      const unencrypted = await generateKeyPair(
        { name: "Empty Passphrase User", email: "empty-passphrase@test.local" },
        "",
        "ecc",
      );

      expect(await isValidArmoredPrivateKey(unencrypted.privateKeyArmored, "")).toBe(true);
    });

    it("returns false with a wrong passphrase", async () => {
      expect(await isValidArmoredPrivateKey(pair.privateKeyArmored, "definitely-wrong")).toBe(
        false,
      );
    });

    it("returns false for a garbage string", async () => {
      expect(await isValidArmoredPrivateKey("garbage", PASSPHRASE)).toBe(false);
      expect(
        await isValidArmoredPrivateKey(
          "-----BEGIN PGP PRIVATE KEY BLOCK-----\n!!!\n-----END PGP PRIVATE KEY BLOCK-----",
          PASSPHRASE,
        ),
      ).toBe(false);
    });
  });
});
