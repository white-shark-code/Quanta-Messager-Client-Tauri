import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { hasKeystore } from "@/infra/tauriBridge";
import { upsertIndexEntry } from "@/features/secure-store/store";

import * as authApi from "./api";
import { getAccessToken, setAccessToken } from "./accessToken";
import { bindTokenProvider, useSessionStore } from "./sessionStore";

// Single shared provider: apiClient always reads the current token
// from the accessToken module (login sets it, lock clears it).
bindTokenProvider(() => getAccessToken());

/**
 * Read the access token captured by the last `useLogin` / unlock.
 *
 * Re-exported here for backward compatibility (`generateAndStoreKey`
 * imports it from `./queries`); the source of truth is
 * `./accessToken`, which is never persisted across reloads.
 */
export { getAccessToken };

export function useLogin() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (req: authApi.LoginRequest): Promise<authApi.MeResponse> => {
      const res = await authApi.login(req);
      setAccessToken(res.access_token);
      return authApi.me();
    },
    onSuccess: async (user) => {
      const { setUser, setUnlocked } = useSessionStore.getState();
      setUser({ id: user.id, email: user.email });
      setUnlocked(true);

      // Refresh the device-wide index exactly once per login — this is
      // the canonical "lastUsedAt" refresh path. Unlock and lock cycles
      // within the same session must NOT touch the index.
      //
      // Best-effort: an index-update failure (e.g. transient FS error,
      // first-run `keystores/` directory race) MUST NOT block login.
      // The caller still gets a valid session via the bearer token
      // below — the index is metadata that the next login can rebuild.
      try {
        await upsertIndexEntry({
          userId: user.id,
          email: user.email,
          lastUsedAt: new Date().toISOString(),
        });
      } catch {
        // ignored — see comment above
      }

      // Decide where to go based on per-user keystore presence.
      const exists = await hasKeystore(user.id);
      const dest = exists
        ? `/unlock?userId=${encodeURIComponent(user.id)}`
        : `/create-keystore?userId=${encodeURIComponent(user.id)}`;
      navigate(dest, { replace: true });
    },
  });
}

export function useRegister() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: () => {
      navigate("/setup-key");
    },
  });
}

export function useMe() {
  const isUnlocked = useSessionStore((s) => s.isUnlocked);
  return useQuery({
    queryKey: ["me"],
    queryFn: authApi.me,
    enabled: isUnlocked,
  });
}
