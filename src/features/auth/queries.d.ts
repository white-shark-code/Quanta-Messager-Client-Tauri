import * as authApi from "./api";
/**
 * Read the access token captured by the last `useLogin` mutation.
 *
 * The token lives in a module-private variable (`currentToken`) rather
 * than inside `sessionStore` because it must never be persisted across
 * reloads — once the in-memory store is gone, the user has to log in
 * again. Exposed here so `SetupKeyRoute` / `generate.ts` can persist it
 * into the encrypted keystore right after key creation, before any
 * component unmounts and loses access via `bindTokenProvider`.
 */
export declare function getAccessToken(): string | null;
export declare function useLogin(): import("@tanstack/react-query").UseMutationResult<authApi.MeResponse, Error, authApi.LoginRequest, unknown>;
export declare function useRegister(): import("@tanstack/react-query").UseMutationResult<authApi.RegisterResponse, Error, authApi.RegisterRequest, unknown>;
export declare function useMe(): import("@tanstack/react-query").UseQueryResult<authApi.MeResponse, Error>;
