import { createTheme } from "@mantine/core";
const quant = [
    "#e3f2fd",
    "#bbdefb",
    "#90caf9",
    "#64b5f6",
    "#42a5f5",
    "#2196f3",
    "#1e88e5",
    "#1976d2",
    "#1565c0",
    "#0d47a1",
];
export const theme = createTheme({
    primaryColor: "quant",
    primaryShade: { light: 6, dark: 5 },
    defaultRadius: "md",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    headings: {
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontWeight: "600",
    },
    colors: {
        quant,
    },
    white: "#ffffff",
    black: "#1a1b1e",
    components: {
        Button: {
            defaultProps: {
                variant: "filled",
            },
        },
    },
});
