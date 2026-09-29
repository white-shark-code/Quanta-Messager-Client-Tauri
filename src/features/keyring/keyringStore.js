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
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { useSessionStore } from "@/features/auth/sessionStore";
import * as keyring from "./encrypt";
const emptyState = {
    status: "empty",
    publicKey: null,
    privateKey: null,
    publicKeyArmored: null,
    fingerprint: null,
    passphrase: null,
    dialogKeyB64: null,
    error: null,
};
function messageOf(err) {
    return err instanceof Error ? err.message : String(err);
}
export const useKeyringStore = create()(subscribeWithSelector((set) => ({
    ...emptyState,
    setStatus: (status) => set({ status }),
    setKeys: async (publicKeyArmored, privateKeyArmored, passphrase, dialogKeyB64) => {
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
                dialogKeyB64: dialogKeyB64 ?? null,
                error: null,
            });
        }
        catch (err) {
            set({ ...emptyState, error: messageOf(err) });
        }
    },
    setKeysFromPair: async (pair, passphrase, dialogKeyB64) => {
        await useKeyringStore
            .getState()
            .setKeys(pair.publicKeyArmored, pair.privateKeyArmored, passphrase, dialogKeyB64);
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
                dialogKeyB64: null,
                error: null,
            });
        }
        catch (err) {
            set({ ...emptyState, error: messageOf(err) });
        }
    },
    setDialogKey: (dialogKeyB64) => set({ dialogKeyB64 }),
    // Сброс ссылки на `privateKey` — единственный способ освободить
    // расшифрованные secret-параметры в openpgp v6 (`clearPrivateParams`
    // там документированно no-op). `publicKey`/`publicKeyArmored`/
    // `fingerprint` сохраняются, чтобы UI продолжал показывать
    // идентичность на экране блокировки.
    // `dialogKeyB64` тоже стирается — без него шифрованные блобы
    // диалогов на диске не читаются до следующего unlock.
    lock: () => set({
        status: "locked",
        privateKey: null,
        passphrase: null,
        dialogKeyB64: null,
    }),
    clear: () => set({ ...emptyState }),
    setError: (msg) => set({ error: msg }),
})));
useKeyringStore.subscribe((state) => state.fingerprint, (fingerprint) => {
    if (fingerprint !== null) {
        useSessionStore.getState().setFingerprint(fingerprint);
    }
});
