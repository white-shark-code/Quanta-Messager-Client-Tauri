/**
 * UI-side glue between `keyring` (PGP), `secure-store` (encrypted
 * keystore on disk) and `tauriBridge` (filesystem dialogs).
 *
 * Design constraints (see `docs/design.md` §5.1, §5.2, §9.2):
 *   - **No React.** This module is called from `SetupKeyRoute`,
 *     `CreateKeystoreRoute` and any future onboarding flow; keeping
 *     the side-effectful work here keeps the components thin.
 *   - **Server → disk order.** Phase A (`prepareGeneratedPair` /
 *     `prepareImportedPair`) builds the PGP pair purely in memory with
 *     NO disk writes. The route then uploads the public key via
 *     `changePublicKey`, and only after the server accepts it Phase B
 *     (`persistPreparedPair`) writes the keystore (`writeKeystore` +
 *     `upsertIndexEntry` + in-memory `setKeys`). A network failure
 *     during upload therefore leaves no `.qks` on disk, and the
 *     silent resume flag (`auth/onboardingPending`, set before Phase A
 *     and cleared after Phase B) routes the next login back to key
 *     generation instead of `/chats`.
 *   - If the server accepted a key whose local pair was subsequently
 *     lost, we deliberately generate a fresh pair over it (traffic
 *     encrypted to the lost key is unrecoverable — accepted trade-off,
 *     product decision 1.3).
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
 * In-memory result of Phase A: everything Phase B needs to persist the
 * keystore after the server has accepted the public key. Contains
 * secrets — keep in component state only, never in storage, and drop
 * it once Phase B succeeds (or the flow is abandoned).
 */
export interface PreparedKeyMaterial {
  publicKeyArmored: string;
  privateKeyArmored: string;
  fingerprint: string;
  /** Freshly minted dialog-store key (persisted verbatim by Phase B). */
  dialogKey: string;
  /**
   * Effective PGP passphrase that unlocks `privateKeyArmored`
   * (already resolved: `undefined` input → `""`, i.e. unencrypted key
   * packet per RFC 9580 §5.1). Passed to `setKeys`, NOT to disk
   * encryption — the keystore passphrase stays a separate argument.
   */
  pgpPassphrase: string;
}

function requireOnboardingSession(caller: string): { userId: string; accessToken: string } {
  const user = useSessionStore.getState().user;
  const accessToken = getAccessToken();
  if (user === null) {
    throw new Error(`${caller}: no user in sessionStore`);
  }
  if (accessToken === null) {
    throw new Error(`${caller}: no access token captured from login`);
  }
  return { userId: user.id, accessToken };
}

/**
 * Phase A (generate): create a fresh PGP pair purely in memory.
 *
 * No disk writes, no index writes, no store writes — the caller uploads
 * `prepared.publicKeyArmored` via `changePublicKey` first and calls
 * `persistPreparedPair` only on success, so the same `prepared` value
 * can be retried after a network failure without regenerating.
 */
export async function prepareGeneratedPair(
  userEmail: string,
  pgpPassphrase: string | undefined,
  algorithm: KeyAlgorithm = "ecc",
): Promise<PreparedKeyMaterial> {
  requireOnboardingSession("prepareGeneratedPair");

  // OpenPGP accepts an empty passphrase to mean "do not encrypt this
  // key" (RFC 9580 §5.1). Pass through whatever the caller chose —
  // including an empty string — verbatim.
  const effectivePgp = pgpPassphrase ?? "";
  const pair = await keyring.generateKeyPair(
    { name: userEmail.split("@")[0] ?? userEmail, email: userEmail },
    effectivePgp,
    algorithm,
  );
  const fingerprint = await keyring.fingerprintOf(pair.publicKeyArmored);
  return {
    publicKeyArmored: pair.publicKeyArmored,
    privateKeyArmored: pair.privateKeyArmored,
    fingerprint,
    dialogKey: generateDialogKeyB64(),
    pgpPassphrase: effectivePgp,
  };
}

/**
 * Phase A (import): validate an existing ASCII-armored private key
 * purely in memory.
 *
 * Fails fast on invalid armor / wrong passphrase before anything is
 * uploaded or written. Like the generate path, the returned `prepared`
 * value survives an upload failure and can be retried verbatim.
 */
export async function prepareImportedPair(
  armoredPrivate: string,
  armoredPublic: string,
  passphrase: string,
): Promise<PreparedKeyMaterial> {
  requireOnboardingSession("prepareImportedPair");

  const valid = await isValidArmoredPrivateKey(armoredPrivate, passphrase);
  if (!valid) {
    throw new Error("Invalid private key or wrong passphrase");
  }

  const fingerprint = await keyring.fingerprintOf(armoredPublic);
  return {
    publicKeyArmored: armoredPublic,
    privateKeyArmored: armoredPrivate,
    fingerprint,
    dialogKey: generateDialogKeyB64(),
    pgpPassphrase: passphrase,
  };
}

/**
 * Phase B: persist a Phase-A pair to the encrypted keystore AFTER the
 * server has accepted the public key.
 *
 * Writes the keystore, upserts the index entry, and pushes the parsed
 * keys into `keyringStore` + session fingerprint. Overwrites any
 * previous keystore for this user (server-accepted-but-locally-lost
 * pairs are replaced by design, decision 1.3).
 */
export async function persistPreparedPair(
  userEmail: string,
  keystorePassphrase: string,
  prepared: PreparedKeyMaterial,
): Promise<void> {
  const { userId, accessToken } = requireOnboardingSession("persistPreparedPair");
  if (keystorePassphrase.length === 0) {
    throw new Error("persistPreparedPair: keystore passphrase must not be empty");
  }

  const payload: KeystorePayload = {
    version: 1,
    user: { id: userId, email: userEmail },
    accessToken,
    privateKeyArmored: prepared.privateKeyArmored,
    publicKeyArmored: prepared.publicKeyArmored,
    fingerprint: prepared.fingerprint,
    dialogKey: prepared.dialogKey,
  };

  await writeKeystore(userId, payload, keystorePassphrase);
  // Make the freshly written keystore discoverable from the index —
  // without this, the next cold-start login screen would not list this
  // user in the device picker (and `hasKeystore(userId)` would be the
  // only way to know, which is per-user and not user-picker-friendly).
  await upsertIndexEntry({
    userId,
    email: userEmail,
    lastUsedAt: new Date().toISOString(),
  });
  // The in-memory `passphrase` we hold in `keyringStore` is the PGP
  // passphrase — it's what `openpgp.decryptKey` needs on every encrypt
  // call. The keystore passphrase is only needed at unlock time and
  // never enters memory long-term.
  await useKeyringStore
    .getState()
    .setKeys(
      prepared.publicKeyArmored,
      prepared.privateKeyArmored,
      prepared.pgpPassphrase,
      prepared.dialogKey,
    );
  useSessionStore.getState().setFingerprint(prepared.fingerprint);
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
  if (passphrase.length === 0) {
    throw new Error("generateAndStoreKey: keystore passphrase must not be empty");
  }
  // Legacy single-shot path (disk write with no server round-trip in
  // between). Onboarding routes use the two-phase API directly
  // (prepare → changePublicKey → persist) so a failed upload leaves no
  // `.qks` behind; this wrapper stays for any non-route callers.
  const prepared = await prepareGeneratedPair(userEmail, pgpPassphrase, algorithm);
  await persistPreparedPair(userEmail, passphrase, prepared);
  return {
    privateKeyArmored: prepared.privateKeyArmored,
    publicKeyArmored: prepared.publicKeyArmored,
    fingerprint: prepared.fingerprint,
  };
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
  // Legacy single-shot path — same layering note as
  // `generateAndStoreKey` above: routes use prepare → changePublicKey →
  // persist so upload failures leave the disk untouched.
  const prepared = await prepareImportedPair(armoredPrivate, armoredPublic, passphrase);
  await persistPreparedPair(userEmail, passphrase, prepared);
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
