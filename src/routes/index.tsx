import { useEffect, useRef, useState } from "react";
import {
  createBrowserRouter,
  Link,
  useLocation,
  useNavigate,
  type RouteObject,
} from "react-router-dom";
import { Anchor, Button, Paper, PasswordInput, Stack, TextInput, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { useLogin } from "@/features/auth/queries";
import { describeLoginError } from "@/features/auth/registerFlow";
import { resolveRegistrationMode } from "@/features/meta/api";
import { useServerMeta } from "@/features/meta/queries";
import { toUserMessage } from "@/infra/error";
import { getLastUserId } from "@/features/secure-store/store";
import { BrandLockup } from "@/ui/components/BrandLogo";
import { BootSplash } from "@/ui/components/BootSplash";

import { AppShellRoute } from "./AppShellRoute";
import { ChatRoute } from "./ChatRoute";
import { ChatsRoute } from "./ChatsRoute";
import { CreateKeystoreRoute } from "./CreateKeystoreRoute";
import { NewChatRoute } from "./NewChatRoute";
import { NewGroupRoute } from "./NewGroupRoute";
import { RegisterRoute } from "./RegisterRoute";
import { RequireAuth } from "./RequireAuth";
import { SettingsRoute } from "./SettingsRoute";
import { SetupKeyRoute } from "./SetupKeyRoute";
import { UnlockRoute } from "./UnlockRoute";

export function LoginRoute(): JSX.Element {
  const { t } = useTranslation();
  const login = useLogin();
  const { data: meta } = useServerMeta();
  // While /meta loads, data is undefined → resolveRegistrationMode falls
  // back to "approval", so the register link would be visible by default.
  // Hide it until meta is defined so closed mode never flashes the link.
  const mode = resolveRegistrationMode(meta);
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

  // In "approval" mode a 400 from login is most likely "account exists
  // but is not approved yet" — show the pending hint under the generic
  // message. `describeLoginError` returns null for anything else.
  const hintKey = login.error !== null ? describeLoginError(login.error, mode) : null;

  return (
    <Paper p="xl" maw={400} mx="auto" mt={80}>
      <Stack align="center" mb="lg">
        <BrandLockup size={40} />
      </Stack>
      <Title order={2} mb="md" ta="center">
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
        {login.error !== null && (
          <div style={{ color: "red" }}>
            {toUserMessage(login.error)}
            {hintKey !== null && <div>{t(hintKey)}</div>}
          </div>
        )}
        <Button onClick={handleSubmit} loading={login.isPending}>
          {t("auth.login.submit")}
        </Button>
        {meta !== undefined && mode !== "closed" && (
          <Anchor component={Link} to="/register" ta="center">
            {t("auth.login.noAccount")} {t("auth.login.registerLink")}
          </Anchor>
        )}
      </Stack>
    </Paper>
  );
}

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

  return <BootSplash />;
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
