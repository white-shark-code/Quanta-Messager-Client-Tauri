import { apiUrl } from "./env";
import { NetworkError, normalizeApiError } from "./error";
import type { Method, RequestOptions } from "./types";

export type TokenProvider = () => string | null;
export type OnUnauthorized = () => void;

const UNLOCK_MODAL_EVENT = "unlock-modal:open";

let getToken: TokenProvider = () => null;
let onUnauthorized: OnUnauthorized = () => undefined;

function dispatchUnlockModal(): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(new CustomEvent(UNLOCK_MODAL_EVENT));
  } catch {
    return;
  }
}

export function configureClient(opts: {
  tokenProvider: TokenProvider;
  onUnauthorized: OnUnauthorized;
}): void {
  getToken = opts.tokenProvider;
  onUnauthorized = opts.onUnauthorized;
}

const BASE64_CHUNK = 0x8000;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    const slice = bytes.subarray(i, i + BASE64_CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return uint8ToBase64(value);
  }
  return value;
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value, jsonReplacer);
}

async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = { ...(options?.headers ?? {}) };

  let payload: BodyInit | undefined;
  if (body instanceof URLSearchParams) {
    payload = body;
    // fetch will set Content-Type automatically to application/x-www-form-urlencoded
  } else if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    payload = jsonStringify(body);
  }

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body: payload ?? null,
      signal: options?.signal ?? null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new NetworkError(
      error instanceof Error ? error.message : "Network request failed",
      error,
    );
  }

  if (!response.ok) {
    const errorBody = await readErrorBody(response);
    if (response.status === 401) {
      try {
        onUnauthorized();
      } finally {
        dispatchUnlockModal();
      }
    }
    throw normalizeApiError(response.status, errorBody);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as unknown as T;
}

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
export const apiClient = {
  async request<T>(
    method: Method,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return request<T>(method, path, body, options);
  },
  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>("GET", path, undefined, options);
  },
  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>("POST", path, body, options);
  },
  async postForm<T>(path: string, form: URLSearchParams, options?: RequestOptions): Promise<T> {
    return request<T>("POST", path, form, options);
  },
  async postMultipart<T>(path: string, form: FormData, options?: RequestOptions): Promise<T> {
    return request<T>("POST", path, form, options);
  },
  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>("DELETE", path, undefined, options);
  },
};
