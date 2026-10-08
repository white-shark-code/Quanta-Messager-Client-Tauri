import { useKeyringStore } from "@/features/keyring/keyringStore";
import * as keyring from "@/features/keyring/encrypt";
import { hasKeystore } from "@/infra/tauriBridge";
import { readKeystore, upsertIndexEntry } from "@/features/secure-store/store";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { ensurePushSubscription } from "@/features/push/subscription";
import { debugLog } from "@/lib/debug";

import { getAccessToken, setAccessToken } from "./accessToken";
import { bindTokenProvider, useSessionStore } from "./sessionStore";

/**
 * Unlock an existing keystore with a passphrase.
 *
 * Two distinct passphrases are involved:
 *   1. **Keystore passphrase** — required. Derives the Argon2id key that
 *      decrypts the ChaCha20-Poly1305 container holding `payload`.
 *   2. **PGP passphrase** — optional. Needed to decrypt the private key
 *      packet itself (passed to `openpgp.decryptKey`). Most users set
 *      the same string for both; the split exists so power users can
 *      rotate them independently.
 *
 * When `pgpPassphrase` is omitted we default to the keystore passphrase
 * — this keeps the simple case ("one passphrase for everything") working
 * with zero UX overhead.
 *
 * Note: we deliberately do NOT call `upsertIndexEntry` here —
 * `lastUsedAt` is refreshed once per session on login, not on every
 * unlock (per product decision).
 */
export async function unlockWithPassphrase(
  userId: string,
  keystorePassphrase: string,
  pgpPassphrase?: string,
): Promise<void> {
  // Fail fast with a clear message if the keystore was deleted while
  // we were sitting on the unlock form — `readKeystore` would otherwise
  // reject with a low-level file-not-found error after a costly
  // Argon2id derivation that was guaranteed to be wasted.
  if (!(await hasKeystore(userId))) {
    throw new Error("Keystore file is missing on disk. Please create one in /create-keystore.");
  }
  const effectivePgpPass = pgpPassphrase ?? keystorePassphrase;
  const payload = await readKeystore(userId, keystorePassphrase);
  await keyring.importPrivateKey(payload.privateKeyArmored, effectivePgpPass);
  await keyring.importPublicKey(payload.publicKeyArmored);
  await useKeyringStore
    .getState()
    .setKeys(
      payload.publicKeyArmored,
      payload.privateKeyArmored,
      effectivePgpPass,
      payload.dialogKey,
    );

  useSessionStore.getState().setUser({ id: payload.user.id, email: payload.user.email });
  useSessionStore.getState().setUnlocked(true);
  useSessionStore.getState().setFingerprint(payload.fingerprint);

  // Publish the keystore bearer into the shared in-memory holder and
  // (re)point apiClient at it via the single shared provider shape.
  // The same `() => getAccessToken()` getter is bound at login, so
  // lock() clearing the holder revokes both paths at once.
  setAccessToken(payload.accessToken);
  bindTokenProvider(() => getAccessToken());
  // Best-effort Web Push re-subscription (B2): if the user explicitly
  // enabled push before locking, re-register the subscription now that a
  // fresh access token is available. Fire-and-forget — a push failure
  // must never block unlock. `push/subscription` imports no auth modules,
  // so this edge cannot create an import cycle.
  if (useSettingsStore.getState().pushEnabled === true) {
    void (async (): Promise<void> => {
      try {
        const res = await ensurePushSubscription();
        if (!res.subscribed) {
          void debugLog("push.resubscribe", new Error(`not subscribed: ${res.reason}`));
        }
      } catch (err: unknown) {
        void debugLog("push.resubscribe", err);
      }
    })();
  }
  // Reference upsertIndexEntry in this module so a future call site
  // can wire it up without re-importing (and so `noUnusedLocals`
  // doesn't complain during incremental refactors).
  void upsertIndexEntry;
}
