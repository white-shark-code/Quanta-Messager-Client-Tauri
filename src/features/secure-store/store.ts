import { readFile, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";

import { decrypt } from "./cipher";
import { DEFAULT_KDF_PARAMS, deriveKey, generateSalt } from "./kdf";
import { parse, serialize } from "./format";
import type { KeystorePayload } from "./types";

export const KEYSTORE_PATH = "keystore.qks";

export async function writeKeystore(payload: KeystorePayload, passphrase: string): Promise<void> {
  const kdfSalt = generateSalt();
  const key = await deriveKey(passphrase, {
    ...DEFAULT_KDF_PARAMS,
    salt: kdfSalt,
  });
  const buf = await serialize(payload, key, kdfSalt);
  await writeFile(KEYSTORE_PATH, buf, { baseDir: BaseDirectory.AppData });
}

export async function readKeystore(passphrase: string): Promise<KeystorePayload> {
  const buf = await readFile(KEYSTORE_PATH, { baseDir: BaseDirectory.AppData });
  const { kdfSalt, chachaNonce, ciphertext } = parse(buf);
  const key = await deriveKey(passphrase, {
    ...DEFAULT_KDF_PARAMS,
    salt: kdfSalt,
  });
  const plaintext = decrypt(ciphertext, key, chachaNonce);
  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as KeystorePayload;
  if (payload.version !== 1) {
    throw new Error(`Unsupported plaintext version: ${payload.version}`);
  }
  return payload;
}
