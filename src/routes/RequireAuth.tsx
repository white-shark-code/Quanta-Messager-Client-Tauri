import { useEffect, useRef, useState, type ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Center, Loader, Stack, Text } from "@mantine/core";

import { useSessionStore } from "@/features/auth/sessionStore";
import { getLastUserId } from "@/features/secure-store/store";

export function RequireAuth({ children }: { children: ReactElement }) {
  const isUnlocked = useSessionStore((s) => s.isUnlocked);
  const location = useLocation();
  const [hydrated, setHydrated] = useState(false);
  // undefined = still resolving, string = keystore owner, null = none.
  const [lastUserId, setLastUserId] = useState<string | null | undefined>(undefined);
  // Cache within one locked episode so re-renders don't re-hit the disk.
  // Reset when unlocked so the next lock re-resolves fresh.
  const cachedRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (isUnlocked) {
      cachedRef.current = undefined;
      setLastUserId(undefined);
      return;
    }
    if (cachedRef.current !== undefined) {
      setLastUserId(cachedRef.current);
      return;
    }
    let cancelled = false;
    void getLastUserId().then((userId) => {
      if (cancelled) return;
      cachedRef.current = userId;
      setLastUserId(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, isUnlocked]);

  if (!hydrated || (!isUnlocked && lastUserId === undefined)) {
    return (
      <Center mih="100vh">
        <Stack align="center" gap="xs">
          <Loader size="md" />
          <Text c="dimmed" size="sm">
            Загрузка сессии…
          </Text>
        </Stack>
      </Center>
    );
  }

  if (!isUnlocked) {
    if (lastUserId !== null && lastUserId !== undefined) {
      return (
        <Navigate
          to={`/unlock?userId=${encodeURIComponent(lastUserId)}`}
          state={{ from: location }}
          replace
        />
      );
    }
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
