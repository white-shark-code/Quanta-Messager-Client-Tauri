import { AppShell, Burger, Group, NavLink, ScrollArea, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconKey, IconMessage, IconPlus, IconSettings } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation } from "react-router-dom";

import { useEventsSocket } from "@/features/events/useEventsSocket";

export function AppShellRoute() {
  // Session-scoped realtime socket (T4). No-op unless unlocked + ws mode.
  // AppShellRoute renders only under RequireAuth, so no extra guard needed.
  useEventsSocket();
  const [opened, { toggle }] = useDisclosure();
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Title order={3}>{t("nav.appName")}</Title>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <ScrollArea>
          <NavLink
            component={Link}
            to="/chats"
            label={t("nav.chats")}
            leftSection={<IconMessage size={18} />}
            active={location.pathname.startsWith("/chats")}
          />
          <NavLink
            component={Link}
            to="/chats/new"
            label={t("nav.newChat")}
            leftSection={<IconPlus size={18} />}
            active={location.pathname === "/chats/new"}
          />
          <NavLink
            component={Link}
            to="/settings"
            label={t("nav.settings")}
            leftSection={<IconSettings size={18} />}
            active={location.pathname === "/settings"}
          />
          <NavLink
            component={Link}
            to="/setup-key"
            label={t("nav.keys")}
            leftSection={<IconKey size={18} />}
            active={location.pathname === "/setup-key"}
          />
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
