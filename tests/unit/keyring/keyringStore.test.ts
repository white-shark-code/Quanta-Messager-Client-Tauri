import type * as openpgp from "openpgp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/keyring/encrypt", async () => {
  const actual = await vi.importActual<typeof import("@/features/keyring/encrypt")>(
    "@/features/keyring/encrypt",
  );
  return {
    ...actual,
    importPrivateKey: vi.fn(),
    importPublicKey: vi.fn(),
  };
});

import * as encrypt from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import { useSessionStore } from "@/features/auth/sessionStore";

const importPrivateKey = vi.mocked(encrypt.importPrivateKey);
const importPublicKey = vi.mocked(encrypt.importPublicKey);

const FP_HEX = "aabbccddeeff00112233445566778899aabbccdd";

function makePrivateKey(): openpgp.PrivateKey {
  return { isDecrypted: () => true } as unknown as openpgp.PrivateKey;
}

function makePublicKey(fingerprintHex: string = FP_HEX): openpgp.Key {
  return {
    getFingerprint: () => fingerprintHex,
  } as unknown as openpgp.Key;
}

const PUBLIC_ARMORED = "-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake-public\n-----END PGP PUBLIC KEY BLOCK-----";
const PRIVATE_ARMORED = "-----BEGIN PGP PRIVATE KEY BLOCK-----\nfake-private\n-----END PGP PRIVATE KEY BLOCK-----";

describe("keyring/keyringStore", () => {
  beforeEach(() => {
    useKeyringStore.getState().clear();
    useSessionStore.setState({ user: null, isUnlocked: false, fingerprint: null });
    importPrivateKey.mockReset();
    importPublicKey.mockReset();
  });

  it("starts in the empty state with no keys and no error", () => {
    const s = useKeyringStore.getState();
    expect(s.status).toBe("empty");
    expect(s.publicKey).toBeNull();
    expect(s.privateKey).toBeNull();
    expect(s.publicKeyArmored).toBeNull();
    expect(s.fingerprint).toBeNull();
    expect(s.passphrase).toBeNull();
    expect(s.error).toBeNull();
  });

  describe("importPublicOnly", () => {
    it("populates public key + armored string + uppercase fingerprint, leaves privateKey/passphrase null", async () => {
      importPublicKey.mockResolvedValueOnce(makePublicKey("abcdef1234567890abcdef1234567890abcdef12"));

      await useKeyringStore.getState().importPublicOnly(PUBLIC_ARMORED);

      const s = useKeyringStore.getState();
      expect(s.status).toBe("ready");
      expect(s.publicKey).not.toBeNull();
      expect(s.publicKeyArmored).toBe(PUBLIC_ARMORED);
      expect(s.fingerprint).toBe("ABCDEF1234567890ABCDEF1234567890ABCDEF12");
      expect(s.privateKey).toBeNull();
      expect(s.passphrase).toBeNull();
      expect(s.error).toBeNull();
      expect(importPublicKey).toHaveBeenCalledWith(PUBLIC_ARMORED);
      expect(importPrivateKey).not.toHaveBeenCalled();
    });

    it("resets to empty and surfaces the error message when import fails", async () => {
      importPublicKey.mockRejectedValueOnce(new Error("bad armor"));

      await useKeyringStore.getState().importPublicOnly("not-an-armored-key");

      const s = useKeyringStore.getState();
      expect(s.status).toBe("empty");
      expect(s.publicKey).toBeNull();
      expect(s.privateKey).toBeNull();
      expect(s.publicKeyArmored).toBeNull();
      expect(s.fingerprint).toBeNull();
      expect(s.passphrase).toBeNull();
      expect(s.error).toBe("bad armor");
    });
  });

  describe("setKeys", () => {
    it("populates publicKey, privateKey, publicKeyArmored, uppercase fingerprint, and passphrase", async () => {
      const passphrase = "correct horse battery staple";
      importPublicKey.mockResolvedValueOnce(makePublicKey("fffefdfcbfaf00112233445566778899aabbccdd"));
      importPrivateKey.mockResolvedValueOnce(makePrivateKey());

      await useKeyringStore.getState().setKeys(PUBLIC_ARMORED, PRIVATE_ARMORED, passphrase);

      const s = useKeyringStore.getState();
      expect(s.status).toBe("ready");
      expect(s.publicKey).not.toBeNull();
      expect(s.privateKey).not.toBeNull();
      expect(s.publicKeyArmored).toBe(PUBLIC_ARMORED);
      expect(s.fingerprint).toBe("FFFEFDFCBFAF00112233445566778899AABBCCDD");
      expect(s.passphrase).toBe(passphrase);
      expect(s.error).toBeNull();
      expect(importPrivateKey).toHaveBeenCalledWith(PRIVATE_ARMORED, passphrase);
      expect(importPublicKey).toHaveBeenCalledWith(PUBLIC_ARMORED);
    });

    it("resets to empty and surfaces the error message when the private-key unlock fails", async () => {
      importPublicKey.mockResolvedValueOnce(makePublicKey());
      importPrivateKey.mockRejectedValueOnce(new Error("wrong passphrase"));

      await useKeyringStore.getState().setKeys(PUBLIC_ARMORED, PRIVATE_ARMORED, "bad");

      const s = useKeyringStore.getState();
      expect(s.status).toBe("empty");
      expect(s.publicKey).toBeNull();
      expect(s.privateKey).toBeNull();
      expect(s.publicKeyArmored).toBeNull();
      expect(s.fingerprint).toBeNull();
      expect(s.passphrase).toBeNull();
      expect(s.error).toBe("wrong passphrase");
    });
  });

  describe("lock", () => {
    it("clears privateKey and passphrase, sets status='locked', keeps publicKey/fingerprint intact", async () => {
      const passphrase = "secret";
      importPublicKey.mockResolvedValueOnce(makePublicKey("aabbccddeeff"));
      importPrivateKey.mockResolvedValueOnce(makePrivateKey());

      await useKeyringStore.getState().setKeys(PUBLIC_ARMORED, PRIVATE_ARMORED, passphrase);
      expect(useKeyringStore.getState().status).toBe("ready");
      expect(useKeyringStore.getState().privateKey).not.toBeNull();

      useKeyringStore.getState().lock();

      const s = useKeyringStore.getState();
      expect(s.status).toBe("locked");
      expect(s.privateKey).toBeNull();
      expect(s.passphrase).toBeNull();
      expect(s.publicKey).not.toBeNull();
      expect(s.publicKeyArmored).toBe(PUBLIC_ARMORED);
      expect(s.fingerprint).toBe("AABBCCDDEEFF");
    });
  });

  describe("clear", () => {
    it("restores the empty state", async () => {
      importPublicKey.mockResolvedValueOnce(makePublicKey("deadbeef"));
      await useKeyringStore.getState().importPublicOnly(PUBLIC_ARMORED);
      expect(useKeyringStore.getState().status).toBe("ready");

      useKeyringStore.getState().clear();

      const s = useKeyringStore.getState();
      expect(s.status).toBe("empty");
      expect(s.publicKey).toBeNull();
      expect(s.privateKey).toBeNull();
      expect(s.publicKeyArmored).toBeNull();
      expect(s.fingerprint).toBeNull();
      expect(s.passphrase).toBeNull();
      expect(s.error).toBeNull();
    });
  });

  describe("setKeysFromPair", () => {
    it("delegates to setKeys with the pair's armored fields and the supplied passphrase", async () => {
      const publicArmored = "-----BEGIN PGP PUBLIC KEY BLOCK-----\nfrom-pair\n-----END PGP PUBLIC KEY BLOCK-----";
      const privateArmored = "-----BEGIN PGP PRIVATE KEY BLOCK-----\nfrom-pair\n-----END PGP PRIVATE KEY BLOCK-----";
      const passphrase = "pair-passphrase";
      importPublicKey.mockResolvedValueOnce(makePublicKey("001122334455"));
      importPrivateKey.mockResolvedValueOnce(makePrivateKey());

      await useKeyringStore
        .getState()
        .setKeysFromPair(
          { publicKeyArmored: publicArmored, privateKeyArmored: privateArmored, fingerprint: "ignored" },
          passphrase,
        );

      const s = useKeyringStore.getState();
      expect(s.status).toBe("ready");
      expect(s.publicKeyArmored).toBe(publicArmored);
      expect(s.privateKey).not.toBeNull();
      expect(s.fingerprint).toBe("001122334455");
      expect(s.passphrase).toBe(passphrase);

      expect(importPrivateKey).toHaveBeenCalledWith(privateArmored, passphrase);
      expect(importPublicKey).toHaveBeenCalledWith(publicArmored);
      expect(importPublicKey).toHaveBeenCalledTimes(1);
    });
  });
});
