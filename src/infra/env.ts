export interface AppEnv {
  apiUrl: string;
  isDev: boolean;
  isProd: boolean;
}

const rawApiUrl = import.meta.env.VITE_API_URL;

if (typeof rawApiUrl !== "string" || rawApiUrl.length === 0) {
  throw new Error(
    "[env] VITE_API_URL is missing or empty. " +
      "Set it in .env (e.g. VITE_API_URL=http://localhost:8000) before building.",
  );
}

export const env: AppEnv = {
  apiUrl: rawApiUrl,
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
};

/**
 * Build an absolute API URL from a relative path.
 *
 * The Quant backend exchanges PGP-encrypted binary blobs as base64-encoded
 * JSON. The `apiClient` (see `infra/apiClient.ts`) handles the
 * `Uint8Array ↔ base64` conversion automatically when serializing request
 * bodies and parsing responses, so callers do not need to encode binary
 * data manually. This helper only joins the configured base URL with a
 * relative path and has no role in body encoding.
 */
export function apiUrl(path: string): string {
  const base = env.apiUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
