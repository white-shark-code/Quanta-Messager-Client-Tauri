import type { Method, RequestOptions } from "./types";
export type TokenProvider = () => string | null;
export type OnUnauthorized = () => void;
export declare function configureClient(opts: {
    tokenProvider: TokenProvider;
    onUnauthorized: OnUnauthorized;
}): void;
/**
 * Typed fetch wrapper for the Quant FastAPI backend.
 *
 * Responsibilities:
 * - Build absolute URLs via {@link apiUrl}.
 * - Inject Bearer token from a configured provider (decoupled from any
 *   secure-store implementation; wire it in `configureClient`).
 * - Serialize JSON request bodies with automatic `Uint8Array → base64`
 *   conversion of binary fields (PGP-encrypted blobs).
 * - Parse FastAPI error responses (`{detail: string | [...]}`) into
 *   {@link ApiError}; transport failures surface as {@link NetworkError}.
 * - Forward `401` to the configured `onUnauthorized` callback (e.g. to
 *   trigger lock-screen UI).
 * - Support request cancellation via {@link AbortSignal}.
 *
 * Convention: `Uint8Array ↔ base64`.
 * PGP-encrypted binary blobs are exchanged with the backend as base64
 * strings inside JSON. Callers can pass `Uint8Array` directly in request
 * bodies; this client encodes them via a custom `JSON.stringify` replacer.
 * No manual base64 conversion is needed at call sites. See also
 * {@link apiUrl} for the related note on URL construction.
 *
 * @example
 * ```ts
 * configureClient({
 *   tokenProvider: () => sessionStore.getState().accessToken,
 *   onUnauthorized: () => sessionStore.lock(),
 * });
 *
 * const me = await apiClient.get<UserRead>("/users/me");
 * await apiClient.post("/messages", { text: "hi", bytes: encrypted });
 * await apiClient.postMultipart("/auth/change-public-key", form);
 * ```
 */
export declare const apiClient: {
    request<T>(method: Method, path: string, body?: unknown, options?: RequestOptions): Promise<T>;
    get<T>(path: string, options?: RequestOptions): Promise<T>;
    post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
    postForm<T>(path: string, form: URLSearchParams, options?: RequestOptions): Promise<T>;
    postMultipart<T>(path: string, form: FormData, options?: RequestOptions): Promise<T>;
    delete<T>(path: string, options?: RequestOptions): Promise<T>;
};
