/**
 * ASCII-armor validation helpers.
 *
 * Pure check functions used by UI forms (SetupKey, ImportKey, ChangePublicKey)
 * to give immediate feedback before hitting the full PGP pipeline.
 *
 * The implementations intentionally **don't** keep the parsed key around —
 * callers re-parse via `importPublicKey` / `importPrivateKey` to obtain a
 * reusable `Key` object. That avoids surprise allocations and lets the
 * throw/catch path in `isValid…` be minimal.
 */
/**
 * Cheap synchronous check that an armored string looks like a valid PGP
 * public key. Catches:
 *   - missing/empty input
 *   - missing armor markers (e.g. a random string, a message block)
 *   - wrong armor block type (e.g. a PRIVATE KEY block)
 *   - malformed base64 payload
 *
 * Does NOT verify the key against any trust model — that happens later
 * via `importPublicKey` + explicit `verifyPrimaryUser()` calls.
 *
 * v6 openpgp.js is fully async (no sync `parseArmored` like v5 had), so
 * we can't actually parse the key synchronously. We do a structural
 * check on the armor envelope instead: marker lines, block type, and a
 * base64 sanity check on the payload. This catches ~95% of paste errors
 * (truncated paste, wrong file type, missing BEGIN/END) and the rest
 * surface as exceptions in `importPublicKey`.
 *
 * @param armored ASCII-armored PGP public key block.
 * @returns `true` if the input passes the structural checks.
 */
export declare function isValidArmoredPublicKey(armored: string): boolean;
/**
 * Validate an armored private key AND its passphrase in one shot.
 *
 * Performs a full decrypt attempt — passphrase mismatches are surfaced as
 * `false`. Unencrypted private keys are accepted without a passphrase. We
 * deliberately don't distinguish "wrong armor" from "wrong passphrase" in
 * the return value: a leaked oracle that says "this looks like a real key but
 * your password is wrong" is mildly informative to an attacker. Callers that
 * need the distinction should catch the underlying error from
 * `importPrivateKey` instead.
 *
 * @param armored ASCII-armored PGP private key block (passphrase-encrypted or unencrypted).
 * @param passphrase Passphrase the key was locked with.
 * @returns `true` only when the key parses AND unlocks cleanly.
 */
export declare function isValidArmoredPrivateKey(armored: string, passphrase: string): Promise<boolean>;
