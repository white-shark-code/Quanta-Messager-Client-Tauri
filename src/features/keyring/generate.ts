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

import {
  readKeystore,
  writeKeystore,
  upsertIndexEntry,
  removeIndexEntry,
  deleteKeystore,
} from "@/features/secure-store/store";
import type { KeystorePayload } from "@/features/secure-store/types";
import { getAccessToken } from "@/features/auth/queries";
import { useSessionStore } from "@/features/auth/sessionStore";
import { pickSaveFile, writeFileBuffer } from "@/infra/tauriBridge";

import * as keyring from "./encrypt";
import { isValidArmoredPrivateKey } from "./armor";
import { useKeyringStore } from "./keyringStore";
import type { KeyAlgorithm, KeyPair } from "./types";

function generateDialogKeyB64(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Generate a fresh PGP key pair, persist it to the encrypted keystore,
 * and push the parsed keys into `keyringStore` so the rest of the app
 * can encrypt/decrypt without re-parsing.
 *
 * `KeystorePayload.user.id` is required by the secure-store format
 * (`features/secure-store/types.ts`); the freshly registered user comes
 * from `sessionStore.user`, which `RegisterRoute` / `useRegister` has
 * populated right before redirecting here.
 *
 * Two distinct passphrases are supported:
 *   - `passphrase`             — **required** — encrypts the ChaCha20
 *     container on disk (Argon2id → ChaCha20-Poly1305). The keystore
 *     MUST be encrypted; there is no UI path that allows a blank one.
 *   - `pgpPassphrase`          — **optional** — encrypts the PGP private
 *     key packet itself (passed to `openpgp.generateKey({passphrase})`).
 *     When omitted or empty, the PGP key is generated *unencrypted* —
 *     this is supported by the OpenPGP spec, but it means anyone who
 *     can decrypt the keystore (i.e. knows `passphrase`) can use the
 *     private key without a second prompt. Empty is the spec-compliant
 *     "no passphrase" mode; pass an explicit string when you want a
 *     separate secret.
 *
 * Algorithm trade-off (propagated to `keyring.generateKeyPair`):
 *   - ECC (Curve25519): ~100ms generation, modern, ~256-bit security
 *     equivalent. Default. Recommended unless talking to legacy GPG <2.3.
 *     // ~100 мс генерация, ~256-бит стойкость, рекомендовано по RFC 9580.
 *   - RSA 4096:        ~3-5s generation, broad compatibility with old clients.
 *     // ~3-5 с генерация, нужна только для совместимости со старым GPG.
 */
export async function generateAndStoreKey(
  userEmail: string,
  passphrase: string,
  pgpPassphrase: string | undefined,
  algorithm: KeyAlgorithm = "ecc",
): Promise<KeyPair> {
  const user = useSessionStore.getState().user;
  const accessToken = getAccessToken();
  if (user === null) {
    throw new Error("generateAndStoreKey: no user in sessionStore");
  }
  if (accessToken === null) {
    throw new Error("generateAndStoreKey: no access token captured from login");
  }
  if (passphrase.length === 0) {
    throw new Error("generateAndStoreKey: keystore passphrase must not be empty");
  }

  // OpenPGP accepts an empty passphrase to mean "do not encrypt this
  // key" (RFC 9580 §5.1). Pass through whatever the caller chose —
  // including an empty string — verbatim.
  const pair = await keyring.generateKeyPair(
    { name: userEmail.split("@")[0] ?? userEmail, email: userEmail },
    pgpPassphrase ?? "",
    algorithm,
  );
  const fingerprint = await keyring.fingerprintOf(pair.publicKeyArmored);

  const payload: KeystorePayload = {
    version: 1,
    user: { id: user.id, email: userEmail },
    accessToken,
    privateKeyArmored: pair.privateKeyArmored,
    publicKeyArmored: pair.publicKeyArmored,
    fingerprint,
    dialogKey: generateDialogKeyB64(),
  };

  await writeKeystore(user.id, payload, passphrase);
  // Make the freshly written keystore discoverable from the index —
  // without this, the next cold-start login screen would not list this
  // user in the device picker (and `hasKeystore(user.id)` would be the
  // only way to know, which is per-user and not user-picker-friendly).
  await upsertIndexEntry({
    userId: user.id,
    email: userEmail,
    lastUsedAt: new Date().toISOString(),
  });
  // The in-memory `passphrase` we hold in `keyringStore` is the PGP
  // passphrase — it's what `openpgp.decryptKey` needs on every encrypt
  // call. The keystore passphrase is only needed at unlock time and
  // never enters memory long-term.
  await useKeyringStore
    .getState()
    .setKeys(pair.publicKeyArmored, pair.privateKeyArmored, pgpPassphrase ?? "", payload.dialogKey);
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
    dialogKey: generateDialogKeyB64(),
  };

  await writeKeystore(user.id, payload, passphrase);
  await upsertIndexEntry({
    userId: user.id,
    email: userEmail,
    lastUsedAt: new Date().toISOString(),
  });
  await useKeyringStore
    .getState()
    .setKeys(pair.publicKeyArmored, pair.privateKeyArmored, passphrase, payload.dialogKey);
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
 * `userId` is required to locate the per-user keystore on disk — this
 * is a multi-user device from now on, so a single keystore path no
 * longer exists.
 *
 * @returns Absolute path of the written file, or `null` if the user
 *          cancelled the save dialog.
 */
export async function exportKeystoreToFile(
  userId: string,
  passphrase: string,
): Promise<string | null> {
  const payload = await readKeystore(userId, passphrase);
  const json = JSON.stringify(payload, null, 2);
  const path = await pickSaveFile({
    defaultPath: "keystore.qks.json",
    filters: [{ name: "Keystore", extensions: ["qks", "json"] }],
  });
  if (path === null) {
    return null;
  }
  await writeFileBuffer(path, new TextEncoder().encode(json));
  return path;
}

/**
 * Create an empty ChaCha20 keystore with NO PGP key at all.
 *
 * Use case: the user has logged in but doesn't want to deal with PGP
 * right now (they'll import or generate one later via `/setup-key`).
 * The keystore still gets written to disk with a valid Argon2id-derived
 * ChaCha20-Poly1305 container so the rest of the app can wire up:
 *   - session (token persisted across reloads)
 *   - `hasKeystore()` → true (so `RootRedirect` stops bouncing them to
 *     `/login` and instead lands them on `/unlock` next time)
 *
 * The empty PGP fields (`privateKeyArmored: ""`, `publicKeyArmored: ""`,
 * `fingerprint: "NO_KEY"`) are sentinel values: `keyringStore` stays in
 * its `empty` state — `publicKey === null`, `privateKey === null` — so
 * the UI correctly shows "Set up keys" / "Unlock" placeholders instead
 * of pretending a key exists.
 */
export async function createBareKeystore(
  userEmail: string,
  keystorePassphrase: string,
): Promise<void> {
  const user = useSessionStore.getState().user;
  const accessToken = getAccessToken();
  if (user === null) {
    throw new Error("createBareKeystore: no user in sessionStore");
  }
  if (accessToken === null) {
    throw new Error("createBareKeystore: no access token captured from login");
  }
  if (keystorePassphrase.length === 0) {
    throw new Error("createBareKeystore: keystore passphrase must not be empty");
  }

  const payload: KeystorePayload = {
    version: 1,
    user: { id: user.id, email: userEmail },
    accessToken,
    privateKeyArmored: "",
    publicKeyArmored: "",
    fingerprint: "NO_KEY",
    dialogKey: generateDialogKeyB64(),
  };

  await writeKeystore(user.id, payload, keystorePassphrase);
  await upsertIndexEntry({
    userId: user.id,
    email: userEmail,
    lastUsedAt: new Date().toISOString(),
  });
}

/**
 * Erase a user's keystore from this device entirely: deletes the
 * encrypted file AND the corresponding entry in the index. The user
 * will need to re-register / re-import a key on next login.
 *
 * Used by the Settings "Log out and erase data" flow.
 */
export async function deleteKeystoreForUser(userId: string): Promise<void> {
  await deleteKeystore(userId);
  await removeIndexEntry(userId);
}
