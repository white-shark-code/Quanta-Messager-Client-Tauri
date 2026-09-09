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
import type { KeyAlgorithm, KeyPair } from "./types";
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
export declare function generateAndStoreKey(userEmail: string, passphrase: string, pgpPassphrase: string | undefined, algorithm?: KeyAlgorithm): Promise<KeyPair>;
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
export declare function importAndStoreKey(armoredPrivate: string, armoredPublic: string, passphrase: string, userEmail: string): Promise<void>;
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
export declare function exportKeystoreToFile(userId: string, passphrase: string): Promise<string | null>;
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
export declare function createBareKeystore(userEmail: string, keystorePassphrase: string): Promise<void>;
/**
 * Erase a user's keystore from this device entirely: deletes the
 * encrypted file AND the corresponding entry in the index. The user
 * will need to re-register / re-import a key on next login.
 *
 * Used by the Settings "Log out and erase data" flow.
 */
export declare function deleteKeystoreForUser(userId: string): Promise<void>;
