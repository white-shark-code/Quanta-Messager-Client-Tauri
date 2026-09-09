import { beforeAll, describe, expect, it } from "vitest";
import { fingerprintOf, generateKeyPair } from "@/features/keyring/encrypt";
const PASSPHRASE = "fingerprint-test-passphrase";
describe("keyring/fingerprintOf", () => {
    let pair;
    beforeAll(async () => {
        pair = await generateKeyPair({ name: "Fingerprint Test", email: "fp@test.local" }, PASSPHRASE, "ecc");
    }, 30_000);
    it("returns an uppercase hex string", async () => {
        const fp = await fingerprintOf(pair.publicKeyArmored);
        expect(fp).toMatch(/^[A-F0-9]+$/);
        expect(fp).toBe(fp.toUpperCase());
        expect(fp).not.toMatch(/[a-z]/);
    });
    it("has the v4 fingerprint length (40 hex chars)", async () => {
        const fp = await fingerprintOf(pair.publicKeyArmored);
        expect(fp).toHaveLength(40);
    });
    it("is stable across multiple calls", async () => {
        const fp1 = await fingerprintOf(pair.publicKeyArmored);
        const fp2 = await fingerprintOf(pair.publicKeyArmored);
        const fp3 = await fingerprintOf(pair.publicKeyArmored);
        expect(fp1).toBe(fp2);
        expect(fp2).toBe(fp3);
    });
    it("matches the fingerprint returned by generateKeyPair", async () => {
        const fp = await fingerprintOf(pair.publicKeyArmored);
        expect(fp).toBe(pair.fingerprint);
    });
});
