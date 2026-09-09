import type { KeystorePayload } from "./types";
export declare const MAGIC: Uint8Array<ArrayBuffer>;
export declare const VERSION = 1;
export declare function serialize(payload: KeystorePayload, key: Uint8Array, kdfSalt: Uint8Array): Promise<Uint8Array>;
export interface ParsedKeystore {
    kdfSalt: Uint8Array;
    chachaNonce: Uint8Array;
    ciphertext: Uint8Array;
}
export declare function parse(buf: Uint8Array): ParsedKeystore;
