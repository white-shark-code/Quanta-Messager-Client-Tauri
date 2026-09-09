import { encrypt as chachaEncrypt } from "./cipher";
export const MAGIC = new Uint8Array([0x51, 0x4b, 0x53, 0x31]);
export const VERSION = 0x01;
const HEADER_SIZE = 4 + 1 + 1 + 16 + 12;
export function serialize(payload, key, kdfSalt) {
    if (kdfSalt.length !== 16) {
        return Promise.reject(new Error("kdfSalt must be exactly 16 bytes"));
    }
    const json = JSON.stringify(payload);
    const plaintext = new TextEncoder().encode(json);
    const nonce = new Uint8Array(12);
    crypto.getRandomValues(nonce);
    const ciphertext = chachaEncrypt(plaintext, key, nonce);
    const buf = new Uint8Array(HEADER_SIZE + ciphertext.length);
    let offset = 0;
    buf.set(MAGIC, offset);
    offset += MAGIC.length;
    buf.set([VERSION, 0x00], offset);
    offset += 2;
    buf.set(kdfSalt, offset);
    offset += kdfSalt.length;
    buf.set(nonce, offset);
    offset += nonce.length;
    buf.set(ciphertext, offset);
    return Promise.resolve(buf);
}
function bytesEqual(a, b) {
    if (a.length !== b.length)
        return false;
    const av = a;
    const bv = b;
    let mismatch = 0;
    for (let i = 0; i < av.length; i++) {
        mismatch |= (av.at(i) ?? 0) ^ (bv.at(i) ?? 0);
    }
    return mismatch === 0;
}
export function parse(buf) {
    if (buf.length < HEADER_SIZE) {
        throw new Error("Keystore file is too short to contain a valid header");
    }
    const magic = buf.slice(0, MAGIC.length);
    if (!bytesEqual(magic, MAGIC)) {
        throw new Error("Invalid keystore magic: not a QKS1 file");
    }
    const version = buf[4] ?? 0;
    if (version !== VERSION) {
        throw new Error(`Unsupported keystore version: 0x${version.toString(16)}`);
    }
    const kdfSalt = buf.slice(6, 6 + 16);
    const chachaNonce = buf.slice(22, 22 + 12);
    const ciphertext = buf.slice(HEADER_SIZE);
    return { kdfSalt, chachaNonce, ciphertext };
}
