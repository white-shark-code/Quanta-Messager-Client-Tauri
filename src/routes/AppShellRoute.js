import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AppShell, Burger, Group, NavLink, ScrollArea, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconKey, IconMessage, IconPlus, IconSettings } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation } from "react-router-dom";
export function AppShellRoute() {
    const [opened, { toggle }] = useDisclosure();
    const location = useLocation();
    const { t } = useTranslation();
    return (_jsxs(AppShell, { header: { height: 60 }, navbar: { width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }, padding: "md", children: [_jsx(AppShell.Header, { children: _jsxs(Group, { h: "100%", px: "md", children: [_jsx(Burger, { opened: opened, onClick: toggle, hiddenFrom: "sm", size: "sm" }), _jsx(Title, { order: 3, children: t("nav.appName") })] }) }), _jsx(AppShell.Navbar, { p: "md", children: _jsxs(ScrollArea, { children: [_jsx(NavLink, { component: Link, to: "/chats", label: t("nav.chats"), leftSection: _jsx(IconMessage, { size: 18 }), active: location.pathname.startsWith("/chats") }), _jsx(NavLink, { component: Link, to: "/chats/new", label: t("nav.newChat"), leftSection: _jsx(IconPlus, { size: 18 }), active: location.pathname === "/chats/new" }), _jsx(NavLink, { component: Link, to: "/settings", label: t("nav.settings"), leftSection: _jsx(IconSettings, { size: 18 }), active: location.pathname === "/settings" }), _jsx(NavLink, { component: Link, to: "/setup-key", label: t("nav.keys"), leftSection: _jsx(IconKey, { size: 18 }), active: location.pathname === "/setup-key" })] }) }), _jsx(AppShell.Main, { children: _jsx(Outlet, {}) })] }));
}
