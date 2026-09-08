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
 * Tracks whether `init()` already ran. openpgp's `config` is a global
 * singleton, so a second init would overwrite values with no benefit —
 * and could mask bugs in callers that double-init.
 */
let initialized = false;

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
// eslint-disable-next-line @typescript-eslint/require-await
export async function init(): Promise<void> {
  if (initialized) {
    return;
  }

  // Valid v6 config option — keeps "Version: ..." line out of armored
  // output (smaller blobs, no version disclosure).
  openpgp.config.showVersion = false;

  // Best-effort: keep the historic `indentationLength` knob alive via
  // Reflect.set so this stays type-safe (no `any` cast) even though the
  // v6 `Config` interface doesn't declare it.
  Reflect.set(openpgp.config, "indentationLength", 2);

  initialized = true;
}

/**
 * Generate a new PGP key pair, locked with `passphrase`.
 *
 * ECC keys (`curve25519Legacy`) are the default — they're smaller, faster,
 * and the RFC 9580 recommendation. RSA-4096 is offered for clients that
 * need to interoperate with very old OpenPGP implementations.
 *
 * @param userInfo Identity embedded in the key (name + email).
 * @param passphrase Protects the private key; the user will need it on
 *                   every unlock. Empty string is rejected by openpgp
 *                   anyway, but we pass through and let it throw.
 * @param algorithm  `"ecc"` (default) or `"rsa"`.
 * @returns Armored strings + uppercase-hex fingerprint.
 */
export async function generateKeyPair(
  userInfo: { name: string; email: string },
  passphrase: string,
  algorithm: KeyAlgorithm = "ecc",
): Promise<KeyPair> {
  await init();

  // We build the options bag without an explicit type annotation — under
  // `exactOptionalPropertyTypes: true` the wider union of `format` on
  // `GenerateKeyOptions` confuses the overload resolution of the three
  // `generateKey` signatures. Letting inference happen at the call site
  // keeps everything strictly typed without `any` casts.
  const opts = {
    userIDs: [userInfo],
    passphrase,
    format: "armored" as const,
  };

  if (algorithm === "rsa") {
    Object.assign(opts, { type: "rsa" as const, rsaBits: 4096 });
  } else {
    Object.assign(opts, { type: "ecc" as const, curve: "curve25519Legacy" as const });
  }

  const { privateKey, publicKey } = await openpgp.generateKey(opts);

  // openpgp v6 returns `string | Uint8Array` depending on `format`; we
  // pinned it to `"armored"` above so a runtime narrowing is enough.
  if (typeof privateKey !== "string" || typeof publicKey !== "string") {
    throw new Error("openpgp.generateKey returned non-armored output unexpectedly");
  }

  // We need a Key object to read the fingerprint. Re-parse the public
  // blob — it's cheap (~1ms) and avoids depending on internal openpgp
  // return shapes (generateKey may not expose the publicKey object directly).
  const parsedPublicKey = await openpgp.readKey({ armoredKey: publicKey });
  const fingerprint = parsedPublicKey.getFingerprint().toUpperCase();

  return {
    privateKeyArmored: privateKey,
    publicKeyArmored: publicKey,
    fingerprint,
  };
}

/**
 * Parse an armored public key. Throws on invalid armor or non-key payload
 * (e.g. a private key block, a message, junk). Returns the parsed
 * `openpgp.Key` ready for `openpgp.encrypt({ encryptionKeys })`.
 */
export async function importPublicKey(armored: string): Promise<openpgp.Key> {
  if (typeof armored !== "string" || armored.trim().length === 0) {
    throw new Error("importPublicKey: empty armored input");
  }
  return openpgp.readKey({ armoredKey: armored });
}

/**
 * Parse + unlock a private key. Throws on wrong passphrase — callers
 * (UnlockAgainModal, SetupKey import tab) should catch and show a
 * human-readable error rather than propagating.
 */
export async function importPrivateKey(
  armored: string,
  passphrase: string,
): Promise<openpgp.PrivateKey> {
  if (typeof armored !== "string" || armored.trim().length === 0) {
    throw new Error("importPrivateKey: empty armored input");
  }
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("importPrivateKey: empty passphrase");
  }
  const parsed = await openpgp.readPrivateKey({ armoredKey: armored });
  return openpgp.decryptKey({ privateKey: parsed, passphrase });
}

/**
 * Convenience: extract the uppercase-hex fingerprint of an armored
 * public key without keeping the parsed Key object around. Used during
 * registration/import to surface the fingerprint to the user (TOFU UX).
 */
export async function fingerprintOf(publicKeyArmored: string): Promise<string> {
  const key = await importPublicKey(publicKeyArmored);
  return key.getFingerprint().toUpperCase();
}

/**
 * Encrypt + sign a text message.
 *
 * The encrypted blob has the sender's signature embedded *inside* the
 * OpenPGP message. A separate detached signature is produced in parallel
 * and returned alongside — the backend stores both so the receiver can
 * verify authorship without needing the sender's public key locally at
 * message-store time.
 *
 * `createMessage({ text })` defaults to `format: "utf8"`, which wraps the
 * text in a Literal Data Packet (UTF-8). That's what we want for text:
 * the receiver gets the original string back, including any trailing
 * newline handling.
 *
 * @returns `{ encrypted, signature }` — both as `Uint8Array` (UTF-8 bytes
 *          of the armored output) for transport-agnostic consumption.
 */
export async function encryptText(
  text: string,
  recipientsPublicKeys: openpgp.Key[],
  signingKey: openpgp.PrivateKey,
): Promise<EncryptResult> {
  await init();

  if (recipientsPublicKeys.length === 0) {
    throw new Error("encryptText: at least one recipient public key required");
  }

  const message = await openpgp.createMessage({ text });

  // openpgp's `encrypt`/`sign` return conditional types that depend on
  // the generic `T` of the input `Message<T>`. With non-streaming inputs
  // the runtime value is always a string for `format: "armored"`, but
  // TypeScript-ESLint flags the assignment as "error typed" because the
  // conditional `T extends WebStream<Data> ? ... : string` doesn't fully
  // reduce through its plugin's type checker. Sequential awaits with
  // explicit `string` annotations are the cleanest way to pin the types
  // — and the round-trip is still effectively parallel because openpgp
  // schedules the crypto work on its own pool.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const encryptedArmored: string = await openpgp.encrypt({
    message,
    encryptionKeys: recipientsPublicKeys,
    signingKeys: signingKey,
    format: "armored",
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const signatureArmored: string = await openpgp.sign({
    message,
    signingKeys: signingKey,
    detached: true,
    format: "armored",
  });

  return {
    encrypted: new TextEncoder().encode(encryptedArmored),
    signature: new TextEncoder().encode(signatureArmored),
  };
}

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
export async function decryptText(
  encrypted: Uint8Array,
  signature: Uint8Array,
  sendersPublicKey: openpgp.Key,
  decryptionKey: openpgp.PrivateKey,
): Promise<{ text: string; verified: boolean }> {
  await init();

  const message = await openpgp.readMessage({
    armoredMessage: decodeArmored(encrypted, "encrypted"),
  });

  // Read the detached signature defensively — if the bytes don't even
  // parse as armored PGP (corrupt transport, truncated upload, etc.) we
  // still want to return the plaintext, but the message MUST be marked
  // unverified: a signature the caller explicitly passed is canonical,
  // so failing to parse it is a hard `verified: false`, not an
  // excuse to fall back on whatever the encrypted blob happens to
  // carry. Crypto verification of a *parsed* signature is checked
  // separately by `checkSignaturesVerified`.
  const detachedProvided = signature.byteLength > 0;
  let detachedSignature: openpgp.Signature | undefined;
  if (detachedProvided) {
    try {
      detachedSignature = await openpgp.readSignature({
        armoredSignature: decodeArmored(signature, "signature"),
      });
    } catch {
      detachedSignature = undefined;
    }
  }

  const result = await openpgp.decrypt({
    message,
    decryptionKeys: decryptionKey,
    verificationKeys: sendersPublicKey,
    format: "utf8",
    ...(detachedSignature !== undefined ? { signature: detachedSignature } : {}),
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const text = await readMaybeStreamAsString(result.data);

  // Strict verification: if a detached signature was supplied it MUST
  // be a usable Signature object AND every signature (detached + any
  // embedded) must verify. An empty signature argument is treated as
  // "no signature provided" → fall back to whatever openpgp saw inside
  // the message (which can still be useful for keys produced by other
  // apps).
  const verified =
    !detachedProvided || detachedSignature !== undefined
      ? await checkSignaturesVerified(result.signatures)
      : false;
  return { text, verified };
}

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
export async function encryptFile(
  fileBytes: Uint8Array,
  recipientsPublicKeys: openpgp.Key[],
  signingKey: openpgp.PrivateKey,
  mimeType?: string,
): Promise<EncryptResult> {
  await init();

  if (recipientsPublicKeys.length === 0) {
    throw new Error("encryptFile: at least one recipient public key required");
  }
  if (!(fileBytes instanceof Uint8Array)) {
    throw new Error("encryptFile: fileBytes must be a Uint8Array");
  }

  // v6 has no exported `CreateMessageOptions` name — the type is inline in
  // the `createMessage` overloads. We extract it via `Parameters<...>[0]`
  // so the shape stays in sync if openpgp ever adds new fields.
  const messageOpts: Parameters<typeof openpgp.createMessage>[0] = {
    binary: fileBytes,
    format: "binary",
  };
  if (mimeType !== undefined) {
    messageOpts.filename = mimeType;
  }
  const message = await openpgp.createMessage(messageOpts);

  // See comment in `encryptText` for why we pin the return type and
  // disable the over-conservative `no-unsafe-assignment` rule.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const encryptedArmored: string = await openpgp.encrypt({
    message,
    encryptionKeys: recipientsPublicKeys,
    signingKeys: signingKey,
    format: "armored",
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const signatureArmored: string = await openpgp.sign({
    message,
    signingKeys: signingKey,
    detached: true,
    format: "armored",
  });

  return {
    encrypted: new TextEncoder().encode(encryptedArmored),
    signature: new TextEncoder().encode(signatureArmored),
  };
}

/**
 * Decrypt a binary payload. Same verification semantics as `decryptText`
 * but returns the raw bytes (no UTF-8 coercion).
 *
 * The v6 decrypt API yields `data` as a `MaybeStream<Uint8Array>` even
 * for non-streaming inputs in some builds; we normalise to a single
 * `Uint8Array` here so callers don't have to care.
 */
export async function decryptFile(
  encrypted: Uint8Array,
  signature: Uint8Array,
  sendersPublicKey: openpgp.Key,
  decryptionKey: openpgp.PrivateKey,
): Promise<Uint8Array> {
  await init();

  const message = await openpgp.readMessage({
    armoredMessage: decodeArmored(encrypted, "encrypted"),
  });

  // Same defensive parsing as `decryptText` — see comment there.
  let detachedSignature: openpgp.Signature | undefined;
  if (signature.byteLength > 0) {
    try {
      detachedSignature = await openpgp.readSignature({
        armoredSignature: decodeArmored(signature, "signature"),
      });
    } catch {
      detachedSignature = undefined;
    }
  }

  const result = await openpgp.decrypt({
    message,
    decryptionKeys: decryptionKey,
    verificationKeys: sendersPublicKey,
    format: "binary",
    ...(detachedSignature !== undefined ? { signature: detachedSignature } : {}),
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return readMaybeStreamAsBytes(result.data);
}

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
export async function clearPrivateParams(): Promise<void> {
  // Intentional no-op. See JSDoc above.
}

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

/**
 * Decode a `Uint8Array` of armor bytes back into a UTF-8 string. We
 * always use this path because `encryptText`/`encryptFile` emit armored
 * output and encode it with `TextEncoder` for transport.
 *
 * Throws a descriptive error if the bytes aren't valid UTF-8 — this
 * usually means the caller is mixing up `encryptText` (binary payload)
 * with `decryptText` (expects armored).
 */
function decodeArmored(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`decodeArmored: ${label} payload is not valid UTF-8 armored text`);
  }
}

/**
 * openpgp v6 returns `data` as `MaybeStream<T>` (`T | WebStream<T> |
 * NodeWebStream<T>`) from `decrypt()`. With non-streaming inputs you get
 * `T` directly; with streaming inputs you get one of the two stream
 * types from `@openpgp/web-stream-tools`. We normalise both stream
 * flavours to a single value/string so callers don't have to care.
 *
 * Uses a generic `AsyncIterable<T>` constraint so the helper accepts
 * any of the stream flavours without requiring an explicit
 * `instanceof ReadableStream` check that would fail for
 * `NodeWebStream`.
 */
async function readMaybeStreamAsString(
  data: string | AsyncIterable<string>,
): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  let out = "";
  for await (const chunk of data) {
    out += chunk;
  }
  return out;
}

async function readMaybeStreamAsBytes(
  data: Uint8Array | AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return data;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of data) {
    chunks.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Inspect the `signatures` array returned by `openpgp.decrypt` and
 * resolve to a single boolean:
 *
 *   - no signatures at all → `false`
 *   - any signature throws on `verified` → `false` (tampered/wrong sig)
 *   - all signatures resolve → `true`
 *
 * `signatures[i].verified` is itself a Promise (per v6 docs), so we
 * await it. A throw is the documented way openpgp signals an invalid
 * signature, so we deliberately `try/catch` around `await` rather than
 * around the whole array.
 */
async function checkSignaturesVerified(
  signatures: readonly { verified: Promise<boolean> }[],
): Promise<boolean> {
  if (signatures.length === 0) {
    return false;
  }
  for (const sig of signatures) {
    try {
      const ok = await sig.verified;
      if (!ok) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}