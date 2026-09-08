import { AppShell, Container, Group, Text, Title } from "@mantine/core";

import { ColorSchemeToggle } from "@/ui/components/ColorSchemeToggle";

export default function App(): JSX.Element {
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Title order={3} fw={600}>
            Quant
          </Title>
          <ColorSchemeToggle />
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="sm" py="md">
          <Text>Bootstrap OK — Mantine active</Text>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
