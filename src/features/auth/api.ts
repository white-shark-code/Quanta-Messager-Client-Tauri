import { apiClient } from "@/infra/apiClient";

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: "bearer";
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
}

export interface MeResponse {
  id: string;
  email: string;
}

export function login(req: LoginRequest): Promise<LoginResponse> {
  return apiClient.post<LoginResponse>("/auth/login", req);
}

export function register(req: RegisterRequest): Promise<RegisterResponse> {
  return apiClient.post<RegisterResponse>("/auth/register", req);
}

export function me(): Promise<MeResponse> {
  return apiClient.get<MeResponse>("/users/me");
}

/**
 * Upload the user's PGP public key after key generation.
 *
 * The backend expects the key as a `text/plain` file inside a multipart
 * form (per `docs/design.md` §5.3 — multipart only for this endpoint).
 * We wrap the armored string in a `Blob` so the wire format is a real
 * file upload rather than a plain text field, which is what FastAPI's
 * `UploadFile` parameter binds to on the server side.
 */
export async function changePublicKey(publicKeyArmored: string): Promise<MeResponse> {
  const form = new FormData();
  form.append(
    "new_public_key",
    new Blob([publicKeyArmored], { type: "text/plain" }),
    "public_key.asc",
  );
  return apiClient.postMultipart<MeResponse>("/auth/change-public-key", form);
}

export async function logout(): Promise<void> {
  try {
    await apiClient.post<void>("/auth/logout");
  } catch {
    // best-effort: server-side logout endpoint may not be implemented yet
  }
}
