import { apiClient } from "@/infra/apiClient";

export type RegistrationMode = "open" | "approval" | "closed";

export interface ServerMeta {
  vapid_public_key: string;
  registration_mode: RegistrationMode;
}

/**
 * Server default for `registration_mode`. The backend starts with
 * "approval", so "approval" is the conservative fallback when /meta is
 * unavailable or the field is missing/unknown.
 */
export const DEFAULT_REGISTRATION_MODE: RegistrationMode = "approval";

const REGISTRATION_MODES: readonly RegistrationMode[] = ["open", "approval", "closed"];

/**
 * Backend meta contract:
 * - `GET /meta` (no auth) → `{vapid_public_key, registration_mode}` and
 *   nothing else; callable before login.
 * - An empty `vapid_public_key` means VAPID is not configured and
 *   push subscription is impossible.
 * - A missing/unknown `registration_mode` is treated by consumers as
 *   "approval" (see `resolveRegistrationMode`).
 */
export async function getMeta(): Promise<ServerMeta> {
  return apiClient.get<ServerMeta>("/meta");
}

/**
 * Resolves the effective registration mode, falling back to "approval"
 * (the server default) when meta is unavailable or the value is missing
 * or not one of the three exact strings.
 */
export function resolveRegistrationMode(meta: ServerMeta | undefined): RegistrationMode {
  return meta !== undefined && REGISTRATION_MODES.includes(meta.registration_mode)
    ? meta.registration_mode
    : DEFAULT_REGISTRATION_MODE;
}
