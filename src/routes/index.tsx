import { useState } from "react";
import {
  createBrowserRouter,
  Link,
  Navigate,
  useLocation,
  useNavigate,
  type Location,
  type RouteObject,
} from "react-router-dom";
import { Anchor, Button, Paper, PasswordInput, Stack, TextInput, Title } from "@mantine/core";

import { useLogin } from "@/features/auth/queries";
import { toUserMessage } from "@/infra/error";

import { AppShellRoute } from "./AppShellRoute";
import { ChatRoute } from "./ChatRoute";
import { ChatsRoute } from "./ChatsRoute";
import { NewChatRoute } from "./NewChatRoute";
import { NewGroupRoute } from "./NewGroupRoute";
import { RequireAuth } from "./RequireAuth";
import { SettingsRoute } from "./SettingsRoute";
import { SetupKeyRoute } from "./SetupKeyRoute";

const Placeholder = ({ name }: { name: string }) => <div>Placeholder: {name}</div>;

export function LoginRoute(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const from =
    (location.state as { from?: Location } | null)?.from?.pathname ?? "/chats";

  function handleSubmit(): void {
    void login
      .mutateAsync({ username: email, password })
      .then(() => {
        navigate(from, { replace: true });
      });
  }

  return (
    <Paper p="md" maw={400} mx="auto" mt={80}>
      <Title order={2} mb="md">
        Login
      </Title>
      <Stack>
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          required
        />
        <PasswordInput
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          required
        />
        {login.error !== null && (
          <div style={{ color: "red" }}>{toUserMessage(login.error)}</div>
        )}
        <Button onClick={handleSubmit} loading={login.isPending}>
          Sign in
        </Button>
        <Anchor component={Link} to="/register" ta="center">
          Don&apos;t have an account? Register
        </Anchor>
      </Stack>
    </Paper>
  );
}

const RegisterRoute = () => <Placeholder name="RegisterRoute" />;
const UnlockAgainRoute = () => <Placeholder name="UnlockAgainRoute" />;

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
];

const routes: RouteObject[] = [
  {
    path: "/",
    element: <Navigate to="/chats" replace />,
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
    element: <UnlockAgainRoute />,
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
