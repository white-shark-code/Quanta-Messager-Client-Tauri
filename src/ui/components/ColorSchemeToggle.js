import { jsx as _jsx } from "react/jsx-runtime";
import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
export function ColorSchemeToggle() {
    const { t } = useTranslation();
    const { setColorScheme } = useMantineColorScheme();
    const computedColorScheme = useComputedColorScheme("dark", {
        getInitialValueInEffect: true,
    });
    const isDark = computedColorScheme === "dark";
    return (_jsx(ActionIcon, { onClick: () => setColorScheme(isDark ? "light" : "dark"), variant: "default", size: "lg", radius: "md", "aria-label": t(isDark ? "common.a11y.switchToLight" : "common.a11y.switchToDark"), title: t(isDark ? "common.a11y.switchToLight" : "common.a11y.switchToDark"), children: isDark ? _jsx(IconSun, { size: 18, stroke: 1.5 }) : _jsx(IconMoon, { size: 18, stroke: 1.5 }) }));
}
