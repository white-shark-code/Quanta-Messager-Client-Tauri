import { argon2id } from "hash-wasm";

export interface KdfParams {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  salt: Uint8Array;
}

export const DEFAULT_KDF_PARAMS: KdfParams = {
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
  salt: new Uint8Array(16),
};

export async function deriveKey(passphrase: string, params: KdfParams): Promise<Uint8Array> {
  const result = await argon2id({
    password: passphrase,
    salt: params.salt,
    iterations: params.iterations,
    memorySize: params.memoryKiB,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: "binary",
  });
  return result;
}

export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}
