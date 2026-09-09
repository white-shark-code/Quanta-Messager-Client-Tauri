export interface KdfParams {
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    salt: Uint8Array;
}
export declare const DEFAULT_KDF_PARAMS: KdfParams;
export declare function deriveKey(passphrase: string, params: KdfParams): Promise<Uint8Array>;
export declare function generateSalt(): Uint8Array;
