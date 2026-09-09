import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AppShell, Container, Group, Text, Title } from "@mantine/core";
import { ColorSchemeToggle } from "@/ui/components/ColorSchemeToggle";
export default function App() {
    return (_jsxs(AppShell, { header: { height: 60 }, padding: "md", children: [_jsx(AppShell.Header, { children: _jsxs(Group, { h: "100%", px: "md", justify: "space-between", wrap: "nowrap", children: [_jsx(Title, { order: 3, fw: 600, children: "Quant" }), _jsx(ColorSchemeToggle, {})] }) }), _jsx(AppShell.Main, { children: _jsx(Container, { size: "sm", py: "md", children: _jsx(Text, { children: "Bootstrap OK \u2014 Mantine active" }) }) })] }));
}
