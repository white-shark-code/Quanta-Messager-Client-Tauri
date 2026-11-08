import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { clearAccessToken, setAccessToken } from "@/features/auth/accessToken";
import { useSessionStore } from "@/features/auth/sessionStore";
import {
  fingerprintOf,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
} from "@/features/keyring/encrypt";
import { prepareImportedPair } from "@/features/keyring/generate";
import type { KeyPair } from "@/features/keyring/types";

import { corruptUserIdPacket } from "./brokenKeyFixture";

const PASSPHRASE = "generate-test-passphrase";

/**
 * `prepareImportedPair()` refuses to work without an onboarding
 * session — it needs both the logged-in user (for the keystore path)
 * and a hot access token. The token lives in a module-private holder
 * that is never persisted, so every test has to publish its own.
 */
const USER = { id: "11111111-2222-3333-4444-555555555555", email: "gen@test.local" };

describe("keyring/generate — prepareImportedPair", () => {
  let pair: KeyPair;

  beforeAll(async () => {
    pair = await generateKeyPair(
      { name: "Generate Test", email: "gen@test.local" },
      PASSPHRASE,
      "ecc",
    );
  }, 30_000);

  beforeEach(() => {
    useSessionStore.setState({ user: USER, isUnlocked: true, fingerprint: null });
    setAccessToken("test-access-token");
  });

  afterEach(() => {
    clearAccessToken();
    useSessionStore.setState({ user: null, isUnlocked: false, fingerprint: null });
  });

  it("derives the public key when only the private key block is pasted", async () => {
    // The Share tab reveals ONLY the private key — the public block is
    // optional and usually empty.
    const privateInput = pair.privateKeyArmored.trim();

    const prepared = await prepareImportedPair(privateInput, "", PASSPHRASE);

    expect(prepared.publicKeyArmored).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    expect(prepared.fingerprint).toBe(await fingerprintOf(pair.publicKeyArmored));
    expect(prepared.privateKeyArmored).toBe(privateInput);
    expect(prepared.pgpPassphrase).toBe(PASSPHRASE);
  });

  it("uses the pasted public key block verbatim", async () => {
    const privateInput = pair.privateKeyArmored.trim();
    const publicInput = pair.publicKeyArmored.trim();

    const prepared = await prepareImportedPair(privateInput, publicInput, PASSPHRASE);

    expect(prepared.publicKeyArmored).toBe(publicInput);
    expect(prepared.fingerprint).toBe(await fingerprintOf(pair.publicKeyArmored));
    expect(prepared.privateKeyArmored).toBe(privateInput);
  });

  it("rejects a wrong passphrase", async () => {
    await expect(
      prepareImportedPair(pair.privateKeyArmored.trim(), "", "definitely-wrong"),
    ).rejects.toThrow();
  });

  it("rejects a garbage private key block", async () => {
    await expect(prepareImportedPair("garbage", "", PASSPHRASE)).rejects.toThrow();
  });

  it("accepts a private key block with surrounding whitespace", async () => {
    const privateInput = pair.privateKeyArmored.trim();

    const prepared = await prepareImportedPair(`\n${privateInput}\n\n  `, "", PASSPHRASE);

    expect(prepared.publicKeyArmored).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    expect(prepared.fingerprint).toBe(await fingerprintOf(pair.publicKeyArmored));
  });

  it("requires an onboarding session (user + access token)", async () => {
    useSessionStore.setState({ user: null, isUnlocked: false, fingerprint: null });
    clearAccessToken();

    await expect(
      prepareImportedPair(pair.privateKeyArmored.trim(), "", PASSPHRASE),
    ).rejects.toThrow(/sessionStore/);
  });

  it("leaves a valid key untouched (no re-certification)", async () => {
    const privateInput = pair.privateKeyArmored.trim();

    const prepared = await prepareImportedPair(privateInput, "", PASSPHRASE);

    // Byte-identical passthrough: a healthy key must NOT be rewritten.
    expect(prepared.privateKeyArmored).toBe(privateInput);
    expect(prepared.fingerprint).toBe(pair.fingerprint);
    // …and the public key is the one derived from that very key.
    const parsed = await importPrivateKey(privateInput, PASSPHRASE);
    expect(prepared.publicKeyArmored).toBe(parsed.toPublic().armor());
  });
});

/**
 * Keys minted by an old buggy build carry an INVALID self-signature.
 * openpgp reports `Signed digest did not match`, and every consumer
 * rejects such a key — the backend imports the uploaded public key
 * with GnuPG, which refuses it with "no user ID - skipped".
 *
 * The import flow repairs the key by re-certifying it with its OWN
 * material: the fingerprint (the identity) must not change.
 */
describe("keyring/generate — prepareImportedPair (broken self-signature)", () => {
  let broken: KeyPair;

  beforeAll(async () => {
    const generated = await generateKeyPair(
      { name: "Broken Fixture", email: "broken-fixture@test.local" },
      PASSPHRASE,
      "ecc",
    );
    // The corruption only touches the User ID packet — the key
    // material (and therefore the fingerprint) stays the same.
    broken = {
      ...generated,
      privateKeyArmored: corruptUserIdPacket(generated.privateKeyArmored),
    };
  }, 30_000);

  beforeEach(() => {
    useSessionStore.setState({ user: USER, isUnlocked: true, fingerprint: null });
    setAccessToken("test-access-token");
  });

  afterEach(() => {
    clearAccessToken();
    useSessionStore.setState({ user: null, isUnlocked: false, fingerprint: null });
  });

  it("the fixture really has an invalid self-signature", async () => {
    const parsed = await importPrivateKey(broken.privateKeyArmored, PASSPHRASE);

    // The secret material still unlocks — only the self-signature is
    // broken.
    expect(parsed.getFingerprint().toUpperCase()).toBe(broken.fingerprint);
    await expect(parsed.toPublic().getPrimaryUser()).rejects.toThrow(/Signed digest did not match/);
  });

  it("repairs the broken key and keeps the fingerprint", async () => {
    const prepared = await prepareImportedPair(broken.privateKeyArmored, "", PASSPHRASE);

    // The re-certified public key must now carry a VALID self-signature.
    const repairedPublic = await importPublicKey(prepared.publicKeyArmored);
    await expect(repairedPublic.getPrimaryUser()).resolves.toBeDefined();

    // The identity must not change: same fingerprint as the original
    // (uncorrupted) key.
    expect(prepared.fingerprint).toBe(broken.fingerprint);

    // The repaired private key still unlocks with the same passphrase.
    const unlocked = await importPrivateKey(prepared.privateKeyArmored, PASSPHRASE);
    expect(unlocked.getFingerprint().toUpperCase()).toBe(broken.fingerprint);
  });

  it("prefers the repaired key over a pasted (equally broken) public block", async () => {
    const prepared = await prepareImportedPair(
      broken.privateKeyArmored,
      broken.publicKeyArmored,
      PASSPHRASE,
    );

    const repairedPublic = await importPublicKey(prepared.publicKeyArmored);
    await expect(repairedPublic.getPrimaryUser()).resolves.toBeDefined();
    expect(prepared.fingerprint).toBe(broken.fingerprint);
  });
});
