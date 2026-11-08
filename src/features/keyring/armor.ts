/**
 * ASCII-armor validation helpers.
 *
 * Pure check functions used by UI forms (SetupKey, ImportKey, ChangePublicKey)
 * to give immediate feedback before hitting the full PGP pipeline.
 *
 * The module also owns the armor-block splitter the import forms use to
 * pick the private/public key out of a pasted blob.
 *
 * The implementations intentionally **don't** keep the parsed key around —
 * callers re-parse via `importPublicKey` / `importPrivateKey` to obtain a
 * reusable `Key` object. That avoids surprise allocations and lets the
 * throw/catch path in `isValid…` be minimal.
 */

import * as openpgp from "openpgp";

/**
 * Armor headers of the two key blocks we care about. The patterns are
 * deliberately NOT global (`g`) — `exec` would then carry `lastIndex`
 * between calls and return alternating results.
 */
const PRIVATE_BLOCK_PATTERN =
  /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/;
const PUBLIC_BLOCK_PATTERN =
  /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/;

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
export function isValidArmoredPublicKey(armored: string): boolean {
  if (typeof armored !== "string") {
    return false;
  }
  const trimmed = armored.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (
    !trimmed.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----") ||
    !trimmed.includes("-----END PGP PUBLIC KEY BLOCK-----")
  ) {
    return false;
  }
  // Pull the base64 payload between the markers and verify it doesn't
  // contain non-base64 chars. We allow newlines and the `=` padding.
  const payloadPattern =
    /-----BEGIN PGP PUBLIC KEY BLOCK-----([\s\S]*?)-----END PGP PUBLIC KEY BLOCK-----/;
  const payloadMatch = payloadPattern.exec(trimmed);
  if (payloadMatch === null) {
    return false;
  }
  return /^[A-Za-z0-9+/=\s]*$/.test(payloadMatch[1] ?? "");
}

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
export async function isValidArmoredPrivateKey(
  armored: string,
  passphrase: string,
): Promise<boolean> {
  if (typeof armored !== "string" || armored.trim().length === 0) {
    return false;
  }
  if (typeof passphrase !== "string") {
    return false;
  }
  try {
    const parsed = await openpgp.readPrivateKey({ armoredKey: armored });
    if (parsed.isDecrypted()) {
      return true;
    }
    await openpgp.decryptKey({ privateKey: parsed, passphrase });
    return true;
  } catch {
    return false;
  }
}

/**
 * Split a pasted blob into its armored private and public key blocks.
 *
 * The import forms accept whatever the user copied: the Share tab hands
 * out *just* the private key, `gpg --armor --export` writes the public
 * block first and the private one after it, and users often paste both
 * blocks surrounded by some chat noise. Splitting on a fixed marker
 * (and on the wrong marker at that) silently produced garbage, so both
 * blocks are extracted independently by their real armor headers — the
 * order in the paste does not matter.
 *
 * Each part is returned **as matched** (no trimming): an empty string
 * means "this block was not in the paste", and the callers trim before
 * they parse.
 *
 * @param input Raw pasted text.
 * @returns The armored private and public key blocks — each `""` when
 *   the paste did not contain it.
 */
export function splitArmoredPaste(input: string): {
  privatePart: string;
  publicPart: string;
} {
  if (typeof input !== "string" || input.length === 0) {
    return { privatePart: "", publicPart: "" };
  }
  const privateMatch = PRIVATE_BLOCK_PATTERN.exec(input);
  const publicMatch = PUBLIC_BLOCK_PATTERN.exec(input);
  return {
    privatePart: privateMatch?.[0] ?? "",
    publicPart: publicMatch?.[0] ?? "",
  };
}
