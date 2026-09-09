export interface AppEnv {
    apiUrl: string;
    isDev: boolean;
    isProd: boolean;
}
export declare const env: AppEnv;
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
export declare function apiUrl(path: string): string;
