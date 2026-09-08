export interface KeystorePayload {
  version: number;
  user: { id: string; email: string };
  accessToken: string;
  privateKeyArmored: string;
  publicKeyArmored: string;
  fingerprint: string;
}

export interface KeystoreFile {
  magic: Uint8Array;
  version: number;
  flags: number;
  kdfSalt: Uint8Array;
  chachaNonce: Uint8Array;
  ciphertext: Uint8Array;
}
