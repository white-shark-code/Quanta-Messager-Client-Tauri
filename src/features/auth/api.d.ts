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
/**
 * Login with OAuth2 password form-encoded body.
 *
 * fastapi-users' default `/auth/login` endpoint uses
 * `OAuth2PasswordRequestForm` which expects form-encoded
 * (`application/x-www-form-urlencoded`) fields, not JSON.
 * See: fastapi_users.router.auth.get_auth_router + BearerTransport.
 */
export declare function login(req: LoginRequest): Promise<LoginResponse>;
export declare function register(req: RegisterRequest): Promise<RegisterResponse>;
export declare function me(): Promise<MeResponse>;
/**
 * Upload the user's PGP public key after key generation.
 *
 * The backend expects the key as a `text/plain` file inside a multipart
 * form (per `docs/design.md` §5.3 — multipart only for this endpoint).
 * We wrap the armored string in a `Blob` so the wire format is a real
 * file upload rather than a plain text field, which is what FastAPI's
 * `UploadFile` parameter binds to on the server side.
 */
export declare function changePublicKey(publicKeyArmored: string): Promise<MeResponse>;
export declare function logout(): Promise<void>;
