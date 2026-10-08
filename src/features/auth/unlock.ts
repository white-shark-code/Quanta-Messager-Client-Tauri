import { useKeyringStore } from "@/features/keyring/keyringStore";
import * as keyring from "@/features/keyring/encrypt";
import { hasKeystore } from "@/infra/tauriBridge";
import { readKeystore, upsertIndexEntry } from "@/features/secure-store/store";

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
  // Reference upsertIndexEntry in this module so a future call site
  // can wire it up without re-importing (and so `noUnusedLocals`
  // doesn't complain during incremental refactors).
  void upsertIndexEntry;
}
