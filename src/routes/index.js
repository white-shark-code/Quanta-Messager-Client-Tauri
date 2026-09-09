import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { createBrowserRouter, Link, useNavigate, } from "react-router-dom";
import { Anchor, Button, Paper, PasswordInput, Stack, TextInput, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useLogin } from "@/features/auth/queries";
import { toUserMessage } from "@/infra/error";
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
const Placeholder = ({ name }) => _jsxs("div", { children: ["Placeholder: ", name] });
export function LoginRoute() {
    const { t } = useTranslation();
    const login = useLogin();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    function handleSubmit() {
        // Navigation after success is handled by `useLogin.onSuccess` —
        // which knows about disk state (keystore vs in-memory) and can route
        // to /setup-key /unlock /chats accordingly. Doing a second
        // `navigate(from)` here would clobber that decision and send a
        // freshly-registered user to /chats even when there's no keystore.
        void login.mutateAsync({ username: email, password });
    }
    return (_jsxs(Paper, { p: "md", maw: 400, mx: "auto", mt: 80, children: [_jsx(Title, { order: 2, mb: "md", children: t("auth.login.title") }), _jsxs(Stack, { children: [_jsx(TextInput, { label: t("auth.login.email"), type: "email", value: email, onChange: (e) => setEmail(e.currentTarget.value), required: true }), _jsx(PasswordInput, { label: t("auth.login.password"), value: password, onChange: (e) => setPassword(e.currentTarget.value), required: true }), login.error !== null && (_jsx("div", { style: { color: "red" }, children: toUserMessage(login.error) })), _jsx(Button, { onClick: handleSubmit, loading: login.isPending, children: t("auth.login.submit") }), _jsxs(Anchor, { component: Link, to: "/register", ta: "center", children: [t("auth.login.noAccount"), " ", t("auth.login.registerLink")] })] })] }));
}
const RegisterRoute = () => _jsx(Placeholder, { name: "RegisterRoute" });
function RootRedirect() {
    const navigate = useNavigate();
    const [decided, setDecided] = useState(false);
    useEffect(() => {
        if (decided)
            return;
        setDecided(true);
        navigate("/login", { replace: true });
    }, [decided, navigate]);
    return null;
}
const protectedRoutes = [
    {
        path: "chats",
        element: _jsx(ChatsRoute, {}),
    },
    {
        path: "chats/new",
        element: _jsx(NewChatRoute, {}),
    },
    {
        path: "chats/new-group",
        element: _jsx(NewGroupRoute, {}),
    },
    {
        path: "chats/:chatId",
        element: _jsx(ChatRoute, {}),
    },
    {
        path: "settings",
        element: _jsx(SettingsRoute, {}),
    },
    {
        path: "setup-key",
        element: _jsx(SetupKeyRoute, {}),
    },
    {
        path: "create-keystore",
        element: _jsx(CreateKeystoreRoute, {}),
    },
];
const routes = [
    {
        path: "/",
        element: _jsx(RootRedirect, {}),
    },
    {
        path: "/login",
        element: _jsx(LoginRoute, {}),
    },
    {
        path: "/register",
        element: _jsx(RegisterRoute, {}),
    },
    {
        path: "/unlock",
        element: _jsx(UnlockRoute, {}),
    },
    {
        element: (_jsx(RequireAuth, { children: _jsx(AppShellRoute, {}) })),
        children: protectedRoutes,
    },
];
export const router = createBrowserRouter(routes);
