/**
 * React Query hooks for the user-lookup endpoints (peer PGP key).
 */
import { type UseQueryResult } from "@tanstack/react-query";
import type { PublicKeyResponse } from "./api";
export declare function useUserPublicKey(userId: string | undefined): UseQueryResult<PublicKeyResponse, Error>;
