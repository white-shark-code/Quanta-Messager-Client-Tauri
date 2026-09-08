/**
 * Zustand store wrapping the keyring service (`./encrypt`, TASK-012).
 *
 * Design constraints (see `docs/design.md` §6.2):
 *   - **No persist middleware.** The passphrase and the decrypted
 *     `PrivateKey` object must never survive an app restart — persisting
 *     them would break the zero-knowledge guarantee.
 *   - `lock()` drops the private-key reference and the passphrase but
 *     keeps the public key so incoming messages can still be encrypted
 *     to us / displayed while the app sits behind the lock screen.
 *   - The fingerprint is mirrored into `sessionStore` through a
 *     `subscribeWithSelector` subscription rather than being written from
 *     each action, so any future code path that changes the fingerprint
 *     stays in sync automatically.
 */

import type * as openpgp from "openpgp";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import { useSessionStore } from "@/features/auth/sessionStore";

import * as keyring from "./encrypt";
import type { KeyPair } from "./types";

/**
 * Lifecycle of the local keyring.
 *
 * - `"empty"`      — nothing loaded (fresh install, or after `clear()`).
 * - `"generating"` — a `generateKeyPair` call is in flight.
 * - `"ready"`      — at least the public key is loaded and usable.
 * - `"locked"`     — private key + passphrase wiped, public key retained.
 */
export type KeyringStatus = "empty" | "generating" | "ready" | "locked";

export interface KeyringState {
  status: KeyringStatus;
  publicKey: openpgp.Key | null;
  privateKey: openpgp.PrivateKey | null;
  publicKeyArmored: string | null;
  fingerprint: string | null;
  /** In-memory only. Never persisted, cleared by `lock()`/`clear()`. */
  passphrase: string | null;
  error: string | null;

  setStatus: (status: KeyringStatus) => void;
  setKeys: (
    publicKeyArmored: string,
    privateKeyArmored: string,
    passphrase: string,
  ) => Promise<void>;
  setKeysFromPair: (pair: KeyPair, passphrase: string) => Promise<void>;
  importPublicOnly: (publicKeyArmored: string) => Promise<void>;
  lock: () => void;
  clear: () => void;
  setError: (msg: string | null) => void;
}

const emptyState = {
  status: "empty" as KeyringStatus,
  publicKey: null,
  privateKey: null,
  publicKeyArmored: null,
  fingerprint: null,
  passphrase: null,
  error: null,
} satisfies Omit<
  KeyringState,
  "setStatus" | "setKeys" | "setKeysFromPair" | "importPublicOnly" | "lock" | "clear" | "setError"
>;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useKeyringStore = create<KeyringState>()(
  subscribeWithSelector((set) => ({
    ...emptyState,

    setStatus: (status) => set({ status }),

    setKeys: async (publicKeyArmored, privateKeyArmored, passphrase) => {
      set({ error: null });
      try {
        const privateKey = await keyring.importPrivateKey(privateKeyArmored, passphrase);
        const publicKey = await keyring.importPublicKey(publicKeyArmored);
        set({
          status: "ready",
          publicKey,
          privateKey,
          publicKeyArmored,
          fingerprint: publicKey.getFingerprint().toUpperCase(),
          passphrase,
          error: null,
        });
      } catch (err) {
        set({ ...emptyState, error: messageOf(err) });
      }
    },

    setKeysFromPair: async (pair, passphrase) => {
      await useKeyringStore
        .getState()
        .setKeys(pair.publicKeyArmored, pair.privateKeyArmored, passphrase);
    },

    importPublicOnly: async (publicKeyArmored) => {
      set({ error: null });
      try {
        const publicKey = await keyring.importPublicKey(publicKeyArmored);
        set({
          status: "ready",
          publicKey,
          privateKey: null,
          publicKeyArmored,
          fingerprint: publicKey.getFingerprint().toUpperCase(),
          passphrase: null,
          error: null,
        });
      } catch (err) {
        set({ ...emptyState, error: messageOf(err) });
      }
    },

    // Dropping the `privateKey` reference is the only way to release the
    // decrypted secret params in openpgp v6 (`clearPrivateParams` is a
    // documented no-op there). `publicKey`/`publicKeyArmored`/`fingerprint`
    // survive so the UI can keep showing identity while locked.
    lock: () =>
      set({
        status: "locked",
        privateKey: null,
        passphrase: null,
      }),

    clear: () => set({ ...emptyState }),

    setError: (msg) => set({ error: msg }),
  })),
);

useKeyringStore.subscribe(
  (state) => state.fingerprint,
  (fingerprint) => {
    if (fingerprint !== null) {
      useSessionStore.getState().setFingerprint(fingerprint);
    }
  },
);
