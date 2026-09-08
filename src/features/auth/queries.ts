import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import * as authApi from "./api";
import { bindTokenProvider, useSessionStore } from "./sessionStore";

let currentToken: string | null = null;

bindTokenProvider(() => currentToken);

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
export function getAccessToken(): string | null {
  return currentToken;
}

export function useLogin() {
  return useMutation({
    mutationFn: async (req: authApi.LoginRequest): Promise<authApi.MeResponse> => {
      const res = await authApi.login(req);
      currentToken = res.access_token;
      bindTokenProvider(() => currentToken);
      return authApi.me();
    },
    onSuccess: (user) => {
      const { setUser, setUnlocked } = useSessionStore.getState();
      setUser({ id: user.id, email: user.email });
      setUnlocked(true);
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
