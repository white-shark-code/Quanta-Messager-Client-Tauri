import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  readKeystoreMock,
  importPrivateKeyMock,
  importPublicKeyMock,
  setKeysMock,
  hasKeystoreMock,
  configureClientMock,
} = vi.hoisted(() => ({
  readKeystoreMock: vi.fn(),
  importPrivateKeyMock: vi.fn(),
  importPublicKeyMock: vi.fn(),
  setKeysMock: vi.fn(),
  hasKeystoreMock: vi.fn(),
  configureClientMock: vi.fn(),
}));

vi.mock("@/features/secure-store/store", () => {
  return {
    readKeystore: (...args: unknown[]): unknown => readKeystoreMock(...args) as unknown,
    updateKeystoreToken: vi.fn(),
    writeKeystore: vi.fn(),
    upsertIndexEntry: vi.fn(),
  };
});

vi.mock("@/features/keyring/encrypt", () => {
  return {
    importPrivateKey: (...args: unknown[]): unknown => importPrivateKeyMock(...args) as unknown,
    importPublicKey: (...args: unknown[]): unknown => importPublicKeyMock(...args) as unknown,
  };
});

vi.mock("@/features/keyring/keyringStore", () => {
  return {
    useKeyringStore: {
      getState: () => ({
        setKeys: (...args: unknown[]): unknown => setKeysMock(...args) as unknown,
      }),
    },
  };
});

vi.mock("@/infra/tauriBridge", () => {
  return {
    hasKeystore: (...args: unknown[]): unknown => hasKeystoreMock(...args) as unknown,
  };
});

vi.mock("@/infra/apiClient", () => {
  return {
    configureClient: (...args: unknown[]): unknown => configureClientMock(...args) as unknown,
  };
});

import { unlockWithPassphrase } from "@/features/auth/unlock";
import { useSessionStore } from "@/features/auth/sessionStore";
import type { KeystorePayload } from "@/features/secure-store/types";

const USER_A = "user-aaa-111";

const FAKE_PRIVATE_KEY =
  "-----BEGIN PGP PRIVATE KEY BLOCK-----\n" +
  "lQH+BGcVvBYJKwYBBAHaRw8BAQdAfakeArmoredPrivateKeyBytesAAAA\n" +
  "=zzzz\n" +
  "-----END PGP PRIVATE KEY BLOCK-----\n";

const FAKE_PUBLIC_KEY =
  "-----BEGIN PGP PUBLIC KEY BLOCK-----\n" +
  "mDMEYJZ2YBYJKwYBBAHaRw8BAQdAfakeArmoredPublicKeyBytesAAAA\n" +
  "=abcd\n" +
  "-----END PGP PUBLIC KEY BLOCK-----\n";

const FAKE_PAYLOAD: KeystorePayload = {
  version: 1,
  user: { id: USER_A, email: "alice@example.com" },
  accessToken: "bearer-from-keystore",
  privateKeyArmored: FAKE_PRIVATE_KEY,
  publicKeyArmored: FAKE_PUBLIC_KEY,
  fingerprint: "DEADBEEFCAFEBABE",
  dialogKey: "AAECAwQFBgcICQoLDA0ODw==",
};

describe("auth/unlock", () => {
  beforeEach(() => {
    readKeystoreMock.mockReset();
    importPrivateKeyMock.mockReset();
    importPublicKeyMock.mockReset();
    setKeysMock.mockReset();
    hasKeystoreMock.mockReset();
    configureClientMock.mockReset();

    readKeystoreMock.mockResolvedValue(FAKE_PAYLOAD);
    importPrivateKeyMock.mockResolvedValue({ isDecrypted: () => true });
    importPublicKeyMock.mockResolvedValue({ getFingerprint: () => "DEADBEEFCAFEBABE" });
    setKeysMock.mockResolvedValue(undefined);
    hasKeystoreMock.mockResolvedValue(true);

    useSessionStore.setState({ user: null, isUnlocked: false, fingerprint: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("unlockWithPassphrase", () => {
    it("decrypts the keystore and imports the keypair when only the keystore passphrase is given", async () => {
      await unlockWithPassphrase(USER_A, "keystore-pass");

      expect(hasKeystoreMock).toHaveBeenCalledTimes(1);
      expect(hasKeystoreMock).toHaveBeenCalledWith(USER_A);

      expect(readKeystoreMock).toHaveBeenCalledTimes(1);
      expect(readKeystoreMock).toHaveBeenCalledWith(USER_A, "keystore-pass");

      expect(importPrivateKeyMock).toHaveBeenCalledTimes(1);
      expect(importPrivateKeyMock).toHaveBeenCalledWith(FAKE_PRIVATE_KEY, "keystore-pass");

      expect(importPublicKeyMock).toHaveBeenCalledTimes(1);
      expect(importPublicKeyMock).toHaveBeenCalledWith(FAKE_PUBLIC_KEY);

      expect(setKeysMock).toHaveBeenCalledTimes(1);
      expect(setKeysMock).toHaveBeenCalledWith(
        FAKE_PUBLIC_KEY,
        FAKE_PRIVATE_KEY,
        "keystore-pass",
        FAKE_PAYLOAD.dialogKey,
      );
    });

    it("uses the keystore passphrase as the effective PGP passphrase when none is provided", async () => {
      await unlockWithPassphrase(USER_A, "only-keystore");

      expect(hasKeystoreMock).toHaveBeenCalledWith(USER_A);
      expect(readKeystoreMock).toHaveBeenCalledWith(USER_A, "only-keystore");

      expect(importPrivateKeyMock).toHaveBeenCalledWith(FAKE_PRIVATE_KEY, "only-keystore");
      expect(setKeysMock).toHaveBeenCalledWith(
        FAKE_PUBLIC_KEY,
        FAKE_PRIVATE_KEY,
        "only-keystore",
        FAKE_PAYLOAD.dialogKey,
      );
    });

    it("uses the dedicated PGP passphrase when provided (different from keystore)", async () => {
      await unlockWithPassphrase(USER_A, "keystore-pass", "pgp-pass");

      expect(hasKeystoreMock).toHaveBeenCalledWith(USER_A);
      expect(readKeystoreMock).toHaveBeenCalledWith(USER_A, "keystore-pass");

      expect(importPrivateKeyMock).toHaveBeenCalledWith(FAKE_PRIVATE_KEY, "pgp-pass");
      expect(importPrivateKeyMock).not.toHaveBeenCalledWith(FAKE_PRIVATE_KEY, "keystore-pass");

      expect(setKeysMock).toHaveBeenCalledWith(
        FAKE_PUBLIC_KEY,
        FAKE_PRIVATE_KEY,
        "pgp-pass",
        FAKE_PAYLOAD.dialogKey,
      );
    });

    it("populates the session store with the user and unlocks it", async () => {
      await unlockWithPassphrase(USER_A, "keystore-pass");

      const state = useSessionStore.getState();
      expect(state.user).toEqual({ id: USER_A, email: "alice@example.com" });
      expect(state.isUnlocked).toBe(true);
      expect(state.fingerprint).toBe("DEADBEEFCAFEBABE");
    });

    it("configures apiClient with a tokenProvider returning the bearer from the keystore", async () => {
      await unlockWithPassphrase(USER_A, "keystore-pass");

      expect(configureClientMock).toHaveBeenCalledTimes(1);
      const arg = configureClientMock.mock.calls[0]?.[0] as {
        tokenProvider: () => string | null;
        onUnauthorized: () => void;
      };

      expect(typeof arg.tokenProvider).toBe("function");
      expect(arg.tokenProvider()).toBe("bearer-from-keystore");

      expect(typeof arg.onUnauthorized).toBe("function");
    });

    it("onUnauthorized passed to configureClient soft-locks (retains user)", async () => {
      await unlockWithPassphrase(USER_A, "keystore-pass");

      const arg = configureClientMock.mock.calls[0]?.[0] as {
        onUnauthorized: () => void;
      };

      useSessionStore.getState().setUser({ id: "x", email: "y" });
      useSessionStore.getState().setUnlocked(true);
      useSessionStore.getState().setFingerprint("FF");

      arg.onUnauthorized();

      const state = useSessionStore.getState();
      expect(state.user).toEqual({ id: "x", email: "y" });
      expect(state.isUnlocked).toBe(false);
      expect(state.fingerprint).toBeNull();
    });

    it("propagates errors from readKeystore without touching other state", async () => {
      readKeystoreMock.mockRejectedValueOnce(new Error("Wrong passphrase"));

      await expect(unlockWithPassphrase(USER_A, "bad")).rejects.toThrow("Wrong passphrase");

      expect(importPrivateKeyMock).not.toHaveBeenCalled();
      expect(importPublicKeyMock).not.toHaveBeenCalled();
      expect(setKeysMock).not.toHaveBeenCalled();
      expect(configureClientMock).not.toHaveBeenCalled();
      expect(useSessionStore.getState().user).toBeNull();
      expect(useSessionStore.getState().isUnlocked).toBe(false);
    });

    it("throws when the keystore file is missing on disk (fail-fast before Argon2id)", async () => {
      hasKeystoreMock.mockResolvedValueOnce(false);

      await expect(unlockWithPassphrase(USER_A, "keystore-pass")).rejects.toThrow(
        /Keystore file is missing/,
      );

      expect(readKeystoreMock).not.toHaveBeenCalled();
      expect(importPrivateKeyMock).not.toHaveBeenCalled();
      expect(importPublicKeyMock).not.toHaveBeenCalled();
      expect(setKeysMock).not.toHaveBeenCalled();
      expect(configureClientMock).not.toHaveBeenCalled();
    });

    it("scopes readKeystore and hasKeystore to the supplied userId", async () => {
      await unlockWithPassphrase(USER_A, "keystore-pass");

      const readArgs = readKeystoreMock.mock.calls[0] ?? [];
      const hasArgs = hasKeystoreMock.mock.calls[0] ?? [];
      expect(readArgs[0]).toBe(USER_A);
      expect(hasArgs[0]).toBe(USER_A);
    });
  });
});
