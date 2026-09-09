/**
 * React Query hooks for the user-lookup endpoints (peer PGP key).
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import * as usersApi from "./api";
import type { PublicKeyResponse } from "./api";

export function useUserPublicKey(
  userId: string | undefined,
): UseQueryResult<PublicKeyResponse, Error> {
  return useQuery<PublicKeyResponse, Error>({
    queryKey: ["user-public-key", userId ?? ""],
    // Gate on userId being a real value: avoid firing a 404 against
    // `/users/undefined/public-key`.
    enabled: typeof userId === "string" && userId.length > 0,
    // Public keys change only when the user explicitly uploads a new one,
    // so in principle a long cache is safe. In practice we use a SHORT
    // stale window because the previous long-stale value caused a real
    // UX bug: Alice opened the chat before Bob uploaded his key, so
    // the query cached `{ has_public_key: false }`. After Bob uploaded,
    // Alice's chat kept showing the "no PGP key" banner until she
    // hard-reloaded the app — `staleTime` keeps stale data on screen.
    // 30 s strikes a reasonable balance: manual refresh still works,
    // but mounting the chat (which counts as activity) re-fetches.
    staleTime: 30 * 1000,
    // Always re-fetch when the chat is mounted, even if we have a
    // cached value. Cheap server call, fixes the "stale false" bug.
    refetchOnMount: "always",
    queryFn: () => usersApi.getUserPublicKey(userId!),
  });
}
