/**
 * OpenPGP.js v6 wrapper — the only module in the app that talks to openpgp directly.
 *
 * Design constraints (see `docs/design.md` §5.1):
 *   - Pure functions over openpgp primitives, no React/Zustand coupling.
 *   - All outputs are deterministic: `Uint8Array` for binaries, uppercase-hex
 *     for fingerprints, armored strings for keys.
 *   - Errors are rethrown with a descriptive message; we never swallow.
 *   - `init()` is idempotent so calling code can safely `await init()` at
 *     every entry point (login, unlock, key generation).
 *
 * Out of scope here: trust models, key persistence, UI. Those live in
 * `keyringStore`, `secure-store`, and `routes/SetupKeyRoute` respectively.
 */
import * as openpgp from "openpgp";
import type { EncryptResult, KeyAlgorithm, KeyPair } from "./types";
/**
 * One-time setup of the openpgp global config.
 *
 * In v6 the `config` object is a typed `Config` interface; `indentationLength`
 * is a v5 leftover and not part of the public v6 API. We honour the
 * documented v6 setting (`showVersion = false`, which is also the v6
 * default — kept explicit for auditability) and use `Reflect.set` to
 * preserve the legacy `indentationLength = 2` knob in case openpgp
 * reintroduces it. No-op on subsequent calls.
 */
export declare function init(): Promise<void>;
/**
 * Generate a new PGP key pair, locked with `passphrase`.
 *
 * ECC keys (`curve25519Legacy`) are the default — they're small, fast,
 * and use SHA-2 self-signature hashes for compatibility with classic
 * PGP implementations (GPG, pgpy 0.6, etc.). For broadest compatibility
 * with very old OpenPGP implementations, RSA-4096 is offered.
 *
 * Both the ECC curve (`curve25519Legacy`, not the v6 v3-fingerprint
 * `curve25519`) and the hash algorithm (SHA-256, pinned in `init()`)
 * are deliberately kept on classic RFC 4880 algorithms because the
 * server backend runs `pgpy 0.6` which can't verify RFC 9580-era
 * signatures. If pgpy is upgraded, switch the curve back to
 * `curve25519` and remove the `preferredHashAlgorithm` override in
 * `init()` for stronger crypto.
 *
 * @param userInfo Identity embedded in the key (name + email).
 * @param passphrase Protects the private key; the user will need it on
 *                   every unlock. An empty string leaves the private key
 *                   unencrypted.
 * @param algorithm  `"ecc"` (default, `curve25519Legacy`) or `"rsa"`
 *                   (4096-bit).
 * @returns Armored strings + uppercase-hex fingerprint.
 */
export declare function generateKeyPair(userInfo: {
    name: string;
    email: string;
}, passphrase: string, algorithm?: KeyAlgorithm): Promise<KeyPair>;
/**
 * Parse an armored public key. Throws on invalid armor or non-key payload
 * (e.g. a private key block, a message, junk). Returns the parsed
 * `openpgp.Key` ready for `openpgp.encrypt({ encryptionKeys })`.
 */
export declare function importPublicKey(armored: string): Promise<openpgp.Key>;
/**
 * Parse + unlock a private key. Throws on wrong passphrase — callers
 * (UnlockAgainModal, SetupKey import tab) should catch and show a
 * human-readable error rather than propagating.
 */
export declare function importPrivateKey(armored: string, passphrase: string): Promise<openpgp.PrivateKey>;
/**
 * Convenience: extract the uppercase-hex fingerprint of an armored
 * public key without keeping the parsed Key object around. Used during
 * registration/import to surface the fingerprint to the user (TOFU UX).
 */
export declare function fingerprintOf(publicKeyArmored: string): Promise<string>;
/**
 * Encrypt + sign a text message.
 *
 * Produces TWO independent signatures over TWO different payloads — both
 * signed by the sender — and both are needed end-to-end:
 *
 *   1. **Embedded signature** inside the encrypted PGP message itself
 *      (via `signingKeys` on `openpgp.encrypt`). This one is over the
 *      *plaintext*. It rides along inside the ciphertext so any holder
 *      of the sender's public key — including a recipient who decrypted
 *      it — can verify the content's authenticity.
 *
 *   2. **Detached signature** over the *encrypted* armored blob. This
 *      one is what the **zero-knowledge backend** stores alongside the
 *      ciphertext and verifies on every send: the server never sees the
 *      plaintext and therefore cannot verify against it, so it has to
 *      verify against what it actually has — the armored ciphertext.
 *
 * `createMessage({ text })` defaults to `format: "utf8"`, which wraps
 * the text in a Literal Data Packet (UTF-8). That's what we want for
 * text: the receiver gets the original string back, including any
 * trailing newline handling.
 *
 * @returns `{ encrypted, signature }` — both as `Uint8Array` (UTF-8
 *          bytes of the armored output) for transport-agnostic
 *          consumption.
 */
export declare function encryptText(text: string, recipientsPublicKeys: openpgp.Key[], signingKey: openpgp.PrivateKey): Promise<EncryptResult>;
/**
 * Decrypt + verify a text message.
 *
 * Verification is attempted *best-effort*:
 *   - valid signature on expected key → `verified: true`
 *   - invalid signature (tampered, wrong key, wrong message) → `verified: false`
 *   - missing signature packet / wrong detached sig → `verified: false`
 *
 * The plaintext is returned regardless so the UI can still show a
 * "signature failed" warning instead of dropping the message entirely.
 * Throws only on actual decryption failure (no matching private key,
 * corrupt ciphertext, wrong session key, etc.).
 */
export declare function decryptText(encrypted: Uint8Array, signature: Uint8Array, sendersPublicKey: openpgp.Key, decryptionKey: openpgp.PrivateKey): Promise<{
    text: string;
    verified: boolean;
}>;
/**
 * Encrypt + sign a binary payload (used for media files).
 *
 * Differences from `encryptText`:
 *   - `format: "binary"` on `createMessage` — **no** Literal Data Packet,
 *     so the bytes go through the wire unchanged (no UTF-8 round-trip,
 *     no trailing newline normalization).
 *   - Optional `mimeType` is attached as the literal-data-packet
 *     filename in case the receiver ever inspects metadata. With
 *     `format: "binary"` the filename is dropped during serialization,
 *     so this is purely documentary today; a future v6 upgrade may
 *     expose it via signature notations instead.
 */
export declare function encryptFile(fileBytes: Uint8Array, recipientsPublicKeys: openpgp.Key[], signingKey: openpgp.PrivateKey, mimeType?: string): Promise<EncryptResult>;
/**
 * Decrypt a binary payload. Same verification semantics as `decryptText`
 * but returns the raw bytes (no UTF-8 coercion).
 *
 * The v6 decrypt API yields `data` as a `MaybeStream<Uint8Array>` even
 * for non-streaming inputs in some builds; we normalise to a single
 * `Uint8Array` here so callers don't have to care.
 */
export declare function decryptFile(encrypted: Uint8Array, signature: Uint8Array, sendersPublicKey: openpgp.Key, decryptionKey: openpgp.PrivateKey): Promise<Uint8Array>;
/**
 * Best-effort wipe of decrypted private-key material from memory.
 *
 * openpgp.js v6 dropped the v5 `openpgp.clearPrivateParams()` helper —
 * v6 has no equivalent global API because secret-key params live on
 * the `PrivateKey` object graph and aren't tracked centrally. The
 * reliable way to clear them is to drop every reference the app holds
 * (typically the `privateKey` field in `keyringStore`) and trigger GC.
 *
 * This function exists as a **documentation anchor** and as a place to
 * add future, internal-version-specific cleanup hooks. Right now it's a
 * no-op; the *real* cleanup must happen in the caller by nulling out
 * references to `PrivateKey` instances.
 */
export declare function clearPrivateParams(): Promise<void>;
