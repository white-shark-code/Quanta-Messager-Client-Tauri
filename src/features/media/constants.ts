/**
 * Limits enforced by the media pipeline.
 *
 * Kept in a separate module so the upload (`features/media/pipeline.ts`)
 * and download/decrypt (`features/media/decrypt.ts`, TASK-072) sides can
 * share a single source of truth. The backend enforces the same bound
 * server-side (`MAX_MEDIA_SIZE_BYTES` in `server/src/messages/`); the
 * client-side check exists to fail fast and avoid wasting CPU on a 1 GB
 * upload that the server will reject anyway.
 */

/** 50 MB — matches the backend `MAX_MEDIA_SIZE_BYTES` default. */
export const MAX_MEDIA_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Media-vault quota per user (decrypted bytes at rest). LRU eviction
 * kicks in when a write would exceed it. 300 MB ≈ six max-size
 * attachments — generous for chat media without risking disk abuse.
 */
export const MEDIA_VAULT_QUOTA_BYTES = 300 * 1024 * 1024;
