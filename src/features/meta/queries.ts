import { useQuery } from "@tanstack/react-query";

import { getMeta } from "./api";

/**
 * /meta is unauthenticated, so it is safe to call pre-login.
 */
export function useServerMeta() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: getMeta,
    staleTime: 60_000,
    retry: 1,
  });
}
