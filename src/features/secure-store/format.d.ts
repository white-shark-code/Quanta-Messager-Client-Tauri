import type { KeystorePayload } from "./types";
export declare const MAGIC: Uint8Array<ArrayBuffer>;
export declare const VERSION = 1;
export declare const DIALOG_MAGIC: Uint8Array<ArrayBuffer>;
export declare const DIALOG_VERSION = 1;
export interface SerializedDialog {
    ciphertext: Uint8Array;
    chachaNonce: Uint8Array;
}
export declare function serializeDialog(payload: unknown, key: Uint8Array): SerializedDialog;
export interface ParsedDialog {
    chachaNonce: Uint8Array;
    ciphertext: Uint8Array;
}
export declare function packDialog(parts: SerializedDialog): Uint8Array;
export declare function parseDialog(buf: Uint8Array): ParsedDialog;
export declare function serialize(payload: KeystorePayload, key: Uint8Array, kdfSalt: Uint8Array): Promise<Uint8Array>;
export interface ParsedKeystore {
    kdfSalt: Uint8Array;
    chachaNonce: Uint8Array;
    ciphertext: Uint8Array;
}
export declare function parse(buf: Uint8Array): ParsedKeystore;
