import { useEffect, useRef, useState } from "react";
import {
  createBrowserRouter,
  Link,
  useLocation,
  useNavigate,
  type RouteObject,
} from "react-router-dom";
import {
  Anchor,
  Button,
  Center,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useTranslation } from "react-i18next";

import { useLogin } from "@/features/auth/queries";
import { toUserMessage } from "@/infra/error";
import { getLastUserId } from "@/features/secure-store/store";

import { AppShellRoute } from "./AppShellRoute";
import { ChatRoute } from "./ChatRoute";
import { ChatsRoute } from "./ChatsRoute";
import { CreateKeystoreRoute } from "./CreateKeystoreRoute";
import { NewChatRoute } from "./NewChatRoute";
import { NewGroupRoute } from "./NewGroupRoute";
import { RequireAuth } from "./RequireAuth";
import { SettingsRoute } from "./SettingsRoute";
import { SetupKeyRoute } from "./SetupKeyRoute";
import { UnlockRoute } from "./UnlockRoute";

const Placeholder = ({ name }: { name: string }) => <div>Placeholder: {name}</div>;

export function LoginRoute(): JSX.Element {
  const { t } = useTranslation();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(): void {
    // Navigation after success is handled by `useLogin.onSuccess` —
    // which knows about disk state (keystore vs in-memory) and can route
    // to /setup-key /unlock /chats accordingly. Doing a second
    // `navigate(from)` here would clobber that decision and send a
    // freshly-registered user to /chats even when there's no keystore.
    void login.mutateAsync({ username: email, password });
  }

  return (
    <Paper p="md" maw={400} mx="auto" mt={80}>
      <Title order={2} mb="md">
        {t("auth.login.title")}
      </Title>
      <Stack>
        <TextInput
          label={t("auth.login.email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          required
        />
        <PasswordInput
          label={t("auth.login.password")}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          required
        />
        {login.error !== null && <div style={{ color: "red" }}>{toUserMessage(login.error)}</div>}
        <Button onClick={handleSubmit} loading={login.isPending}>
          {t("auth.login.submit")}
        </Button>
        <Anchor component={Link} to="/register" ta="center">
          {t("auth.login.noAccount")} {t("auth.login.registerLink")}
        </Anchor>
      </Stack>
    </Paper>
  );
}

const RegisterRoute = () => <Placeholder name="RegisterRoute" />;

function RootRedirect(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    void getLastUserId().then((userId) => {
      if (cancelled) return;
      if (userId !== null) {
        navigate(`/unlock?userId=${encodeURIComponent(userId)}`, {
          replace: true,
          state: { from: location },
        });
      } else {
        navigate("/login", { replace: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, location]);

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

const protectedRoutes: RouteObject[] = [
  {
    path: "chats",
    element: <ChatsRoute />,
  },
  {
    path: "chats/new",
    element: <NewChatRoute />,
  },
  {
    path: "chats/new-group",
    element: <NewGroupRoute />,
  },
  {
    path: "chats/:chatId",
    element: <ChatRoute />,
  },
  {
    path: "settings",
    element: <SettingsRoute />,
  },
  {
    path: "setup-key",
    element: <SetupKeyRoute />,
  },
  {
    path: "create-keystore",
    element: <CreateKeystoreRoute />,
  },
];

const routes: RouteObject[] = [
  {
    path: "/",
    element: <RootRedirect />,
  },
  {
    path: "/login",
    element: <LoginRoute />,
  },
  {
    path: "/register",
    element: <RegisterRoute />,
  },
  {
    path: "/unlock",
    element: <UnlockRoute />,
  },
  {
    element: (
      <RequireAuth>
        <AppShellRoute />
      </RequireAuth>
    ),
    children: protectedRoutes,
  },
];

export const router = createBrowserRouter(routes);
