import { configureClient } from "@/infra/apiClient";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import * as keyring from "@/features/keyring/encrypt";
import { readKeystore } from "@/features/secure-store/store";
import { hasKeystore } from "@/infra/tauriBridge";

import { useSessionStore } from "./sessionStore";

export async function unlockWithPassphrase(passphrase: string): Promise<void> {
  const payload = await readKeystore(passphrase);
  await keyring.importPrivateKey(payload.privateKeyArmored, passphrase);
  await keyring.importPublicKey(payload.publicKeyArmored);
  await useKeyringStore
    .getState()
    .setKeys(payload.publicKeyArmored, payload.privateKeyArmored, passphrase);

  useSessionStore.getState().setUser({ id: payload.user.id, email: payload.user.email });
  useSessionStore.getState().setUnlocked(true);
  useSessionStore.getState().setFingerprint(payload.fingerprint);

  configureClient({
    tokenProvider: () => payload.accessToken,
    onUnauthorized: () => useSessionStore.getState().lock(),
  });
}

export async function isKeystoreExists(): Promise<boolean> {
  try {
    await readKeystore("");
    return true;
  } catch {
    try {
      return await hasKeystore();
    } catch {
      return false;
    }
  }
}
