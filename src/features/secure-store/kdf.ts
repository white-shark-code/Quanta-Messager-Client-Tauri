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

const EMPTY_PASSPHRASE_INPUT = new Uint8Array([0xff, 0x00]);

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e).slice(0, 200);
  } catch {
    return String(e);
  }
}

export async function deriveKey(passphrase: string, params: KdfParams): Promise<Uint8Array> {
  let key: Uint8Array;
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
  } catch (e) {
    throw new Error(`Argon2id KDF failed: ${errMsg(e)}`, { cause: e });
  }
  return key;
}

export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}
