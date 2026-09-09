import { argon2id } from "hash-wasm";
export const DEFAULT_KDF_PARAMS = {
    memoryKiB: 65536,
    iterations: 3,
    parallelism: 1,
    salt: new Uint8Array(16),
};
const EMPTY_PASSPHRASE_INPUT = new Uint8Array([0xff, 0x00]);
function errMsg(e) {
    if (e instanceof Error)
        return e.message;
    if (typeof e === "string")
        return e;
    try {
        return JSON.stringify(e).slice(0, 200);
    }
    catch {
        return String(e);
    }
}
export async function deriveKey(passphrase, params) {
    let key;
    try {
        key = await argon2id({
            password: passphrase.length === 0 ? EMPTY_PASSPHRASE_INPUT : passphrase,
            salt: params.salt,
            iterations: params.iterations,
            memorySize: params.memoryKiB,
            parallelism: params.parallelism,
            hashLength: 32,
            outputType: "binary",
        });
    }
    catch (e) {
        throw new Error(`Argon2id KDF failed: ${errMsg(e)}`, { cause: e });
    }
    return key;
}
export function generateSalt() {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    return salt;
}
