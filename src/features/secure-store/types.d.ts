export interface KeystorePayload {
    version: number;
    user: {
        id: string;
        email: string;
    };
    accessToken: string;
    privateKeyArmored: string;
    publicKeyArmored: string;
    fingerprint: string;
    /**
     * Base64-кодированный 32-байтный ключ ChaCha20 для шифрования
     * локального диалог-стора (контейнеры QDLG1 в `dialogs/<userId>/`).
     * Хранится внутри keystore, чтобы переживал перезагрузки, но
     * стирается из памяти на lock. Без этого поля диалог-стор
     * не расшифровывается после рестарта.
     */
    dialogKey: string;
}
export interface KeystoreFile {
    magic: Uint8Array;
    version: number;
    flags: number;
    kdfSalt: Uint8Array;
    chachaNonce: Uint8Array;
    ciphertext: Uint8Array;
}
/**
 * Per-user entry in the unencrypted keystore index. This file lists
 * which userIds have a keystore on disk without requiring the user
 * to unlock each one to find out.
 *
 * Plain metadata only — no secrets. The associated encrypted file
 * `keystores/<userId>.qks` is what holds the actual data.
 */
export interface KeystoreIndexEntry {
    userId: string;
    email: string;
    /** ISO-8601 timestamp of the last login (refreshed on each successful login). */
    lastUsedAt: string;
}
/**
 * The unencrypted index file `keystores/index.json` that lists every
 * user with a keystore on this device.
 */
export interface KeystoreIndex {
    users: KeystoreIndexEntry[];
}
