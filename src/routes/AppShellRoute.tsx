import { AppShell, Burger, Group, NavLink, ScrollArea, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconMessage, IconPlus, IconSettings } from "@tabler/icons-react";
import { Link, Outlet, useLocation } from "react-router-dom";

export function AppShellRoute() {
  const [opened, { toggle }] = useDisclosure();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Title order={3}>Quant</Title>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <ScrollArea>
          <NavLink
            component={Link}
            to="/chats"
            label="Chats"
            leftSection={<IconMessage size={18} />}
            active={location.pathname.startsWith("/chats")}
          />
          <NavLink
            component={Link}
            to="/chats/new"
            label="New chat"
            leftSection={<IconPlus size={18} />}
            active={location.pathname === "/chats/new"}
          />
          <NavLink
            component={Link}
            to="/settings"
            label="Settings"
            leftSection={<IconSettings size={18} />}
            active={location.pathname === "/settings"}
          />
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}