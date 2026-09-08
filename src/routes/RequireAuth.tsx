import { useEffect, useState, type ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Center, Loader, Stack, Text } from "@mantine/core";

import { useSessionStore } from "@/features/auth/sessionStore";

export function RequireAuth({ children }: { children: ReactElement }) {
  const isUnlocked = useSessionStore((s) => s.isUnlocked);
  const location = useLocation();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated) {
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
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
