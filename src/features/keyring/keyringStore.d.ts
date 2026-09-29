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
    /**
     * 32-байтный ChaCha20-ключ для локального диалог-стора.
     * Хранится в base64 (одна каноничная форма с `KeystorePayload.dialogKey`).
     * Ставится на unlock / setup ключа, стирается на `lock()` / `clear()`.
     * Декодируется в `dialogStore` по требованию.
     */
    dialogKeyB64: string | null;
    error: string | null;
    setStatus: (status: KeyringStatus) => void;
    setKeys: (publicKeyArmored: string, privateKeyArmored: string, passphrase: string, dialogKeyB64?: string) => Promise<void>;
    setKeysFromPair: (pair: KeyPair, passphrase: string, dialogKeyB64?: string) => Promise<void>;
    importPublicOnly: (publicKeyArmored: string) => Promise<void>;
    setDialogKey: (dialogKeyB64: string | null) => void;
    lock: () => void;
    clear: () => void;
    setError: (msg: string | null) => void;
}
export declare const useKeyringStore: import("zustand").UseBoundStore<Omit<import("zustand").StoreApi<KeyringState>, "subscribe"> & {
    subscribe: {
        (listener: (selectedState: KeyringState, previousSelectedState: KeyringState) => void): () => void;
        <U>(selector: (state: KeyringState) => U, listener: (selectedState: U, previousSelectedState: U) => void, options?: {
            equalityFn?: ((a: U, b: U) => boolean) | undefined;
            fireImmediately?: boolean;
        } | undefined): () => void;
    };
}>;
