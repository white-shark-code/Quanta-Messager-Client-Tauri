/**
 * UI-side glue between `keyring` (PGP), `secure-store` (encrypted
 * keystore on disk) and `tauriBridge` (filesystem dialogs).
 *
 * Design constraints (see `docs/design.md` §5.1, §5.2, §9.2):
 *   - **No React.** This module is called from `SetupKeyRoute` and any
 *     future onboarding flow; keeping the side-effectful work here
 *     keeps the component a thin render shell.
 *   - **All writes are wrapped in `writeKeystore` first** so a crash
 *     during the public-key upload step can't strand us with a key on
 *     the server but no way to decrypt incoming messages.
 *   - The access token is captured at the moment of key creation —
 *     `sessionStore` intentionally doesn't carry it past a reload, so
 *     we read it from `queries.getAccessToken()` while it's still hot.
 */

import { readKeystore, writeKeystore } from "@/features/secure-store/store";
import type { KeystorePayload } from "@/features/secure-store/types";
import { getAccessToken } from "@/features/auth/queries";
import { useSessionStore } from "@/features/auth/sessionStore";
import { pickSaveFile, writeFileBuffer } from "@/infra/tauriBridge";

import * as keyring from "./encrypt";
import { isValidArmoredPrivateKey } from "./armor";
import { useKeyringStore } from "./keyringStore";
import type { KeyPair } from "./types";

/**
 * Generate a fresh PGP key pair, persist it to the encrypted keystore,
 * and push the parsed keys into `keyringStore` so the rest of the app
 * can encrypt/decrypt without re-parsing.
 *
 * `KeystorePayload.user.id` is required by the secure-store format
 * (`features/secure-store/types.ts`); the freshly registered user comes
 * from `sessionStore.user`, which `RegisterRoute` / `useRegister` has
 * populated right before redirecting here.
 */
export async function generateAndStoreKey(userEmail: string, passphrase: string): Promise<KeyPair> {
  const user = useSessionStore.getState().user;
  const accessToken = getAccessToken();
  if (user === null) {
    throw new Error("generateAndStoreKey: no user in sessionStore");
  }
  if (accessToken === null) {
    throw new Error("generateAndStoreKey: no access token captured from login");
  }

  const pair = await keyring.generateKeyPair(
    { name: userEmail.split("@")[0] ?? userEmail, email: userEmail },
    passphrase,
  );
  const fingerprint = await keyring.fingerprintOf(pair.publicKeyArmored);

  const payload: KeystorePayload = {
    version: 1,
    user: { id: user.id, email: userEmail },
    accessToken,
    privateKeyArmored: pair.privateKeyArmored,
    publicKeyArmored: pair.publicKeyArmored,
    fingerprint,
  };

  await writeKeystore(payload, passphrase);
  await useKeyringStore.getState().setKeys(pair.publicKeyArmored, pair.privateKeyArmored, passphrase);
  useSessionStore.getState().setFingerprint(fingerprint);

  return pair;
}

/**
 * Import an existing ASCII-armored private key, persist it, and push
 * the parsed keys into `keyringStore`.
 *
 * `armoredPrivate` must contain a `BEGIN PGP PRIVATE KEY BLOCK` and
 * unlock with `passphrase` — both are validated up front so we fail
 * fast before touching the filesystem. `armoredPublic` is optional
 * (the private block carries an embedded public component in v4/v6
 * keys), but when supplied it's used verbatim in the keystore and
 * uploaded to the server.
 *
 * Throws on invalid armor / wrong passphrase — the caller surfaces the
 * error via `toUserMessage` in the route.
 */
export async function importAndStoreKey(
  armoredPrivate: string,
  armoredPublic: string,
  passphrase: string,
  userEmail: string,
): Promise<void> {
  const user = useSessionStore.getState().user;
  const accessToken = getAccessToken();
  if (user === null) {
    throw new Error("importAndStoreKey: no user in sessionStore");
  }
  if (accessToken === null) {
    throw new Error("importAndStoreKey: no access token captured from login");
  }

  const valid = await isValidArmoredPrivateKey(armoredPrivate, passphrase);
  if (!valid) {
    throw new Error("Invalid private key or wrong passphrase");
  }

  const fingerprint = await keyring.fingerprintOf(armoredPublic);
  const pair: KeyPair = {
    privateKeyArmored: armoredPrivate,
    publicKeyArmored: armoredPublic,
    fingerprint,
  };

  const payload: KeystorePayload = {
    version: 1,
    user: { id: user.id, email: userEmail },
    accessToken,
    privateKeyArmored: pair.privateKeyArmored,
    publicKeyArmored: pair.publicKeyArmored,
    fingerprint,
  };

  await writeKeystore(payload, passphrase);
  await useKeyringStore.getState().setKeys(pair.publicKeyArmored, pair.privateKeyArmored, passphrase);
  useSessionStore.getState().setFingerprint(fingerprint);
}

/**
 * Export the current keystore as a user-chosen `.qks.json` file.
 *
 * Reads the existing keystore with `passphrase` to verify the user can
 * unlock it, then prompts for a save location and writes the unencrypted
 * `KeystorePayload` as JSON. The exported file is **not** re-encrypted
 * — it contains the access token and the private key, so it must only
 * be moved to a trusted location (USB, encrypted backup volume, etc.).
 *
 * @returns Absolute path of the written file, or `null` if the user
 *          cancelled the save dialog.
 */
export async function exportKeystoreToFile(passphrase: string): Promise<string | null> {
  const payload = await readKeystore(passphrase);
  const json = JSON.stringify(payload, null, 2);
  const path = await pickSaveFile("keystore.qks.json");
  if (path === null) {
    return null;
  }
  await writeFileBuffer(path, new TextEncoder().encode(json));
  return path;
}
