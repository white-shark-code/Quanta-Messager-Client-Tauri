import { env } from "@/infra/env";

/**
 * Build a WebSocket URL for the realtime events channel (`/event/ws`).
 *
 * Conversion rules:
 * - trailing slashes of the base are trimmed;
 * - `http://` → `ws://`, `https://` → `wss://`
 *   (`ws://` / `wss://` bases are kept as-is);
 * - the path `/event/ws?token=<url-encoded token>` is appended.
 *
 * Base resolution priority:
 * 1. explicit `VITE_WS_URL` from `import.meta.env` when it is a non-empty
 *    string (treated as a bare base **without** token, e.g.
 *    `wss://example.com` or `http://localhost:8000`);
 * 2. otherwise the `apiBase` argument (normally `env.apiUrl`).
 *
 * The token is only ever placed into the returned URL via
 * `encodeURIComponent` — this module never logs it.
 *
 * @param apiBase HTTP(S) base URL of the backend (e.g. `env.apiUrl`).
 *   Ignored when `VITE_WS_URL` is set.
 * @param token backend Bearer access token (see `features/auth/accessToken`).
 * @returns full WS URL, e.g.
 *   `ws://localhost:8000/event/ws?token=abc`.
 * @throws Error with a human-readable message when the token is empty or
 *   when neither `VITE_WS_URL` nor `apiBase` provides a base URL.
 */
export function buildWsUrl(apiBase: string, token: string): string {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("[wsUrl] access token is missing or empty. Log in again to obtain a token.");
  }

  const override = (import.meta.env as { VITE_WS_URL?: unknown }).VITE_WS_URL;
  const rawBase = typeof override === "string" && override.length > 0 ? override : apiBase;

  if (typeof rawBase !== "string" || rawBase.length === 0) {
    throw new Error(
      "[wsUrl] API base URL is missing or empty. " +
        "Pass a non-empty apiBase or set VITE_WS_URL / VITE_API_URL.",
    );
  }

  const trimmed = rawBase.replace(/\/+$/, "");
  let wsBase: string;
  if (trimmed.startsWith("https://")) {
    wsBase = `wss://${trimmed.slice("https://".length)}`;
  } else if (trimmed.startsWith("http://")) {
    wsBase = `ws://${trimmed.slice("http://".length)}`;
  } else {
    wsBase = trimmed;
  }

  return `${wsBase}/event/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Build the events WebSocket URL from the build-time environment
 * (`VITE_API_URL` via {@link env}, overridable by `VITE_WS_URL`).
 *
 * @param token backend Bearer access token.
 * @throws Error when the token is empty (see {@link buildWsUrl}).
 */
export function buildWsUrlFromEnv(token: string): string {
  return buildWsUrl(env.apiUrl, token);
}
