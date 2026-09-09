import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Center, Loader, Stack, Text } from "@mantine/core";
import { useSessionStore } from "@/features/auth/sessionStore";
export function RequireAuth({ children }) {
    const isUnlocked = useSessionStore((s) => s.isUnlocked);
    const location = useLocation();
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => {
        setHydrated(true);
    }, []);
    if (!hydrated) {
        return (_jsx(Center, { mih: "100vh", children: _jsxs(Stack, { align: "center", gap: "xs", children: [_jsx(Loader, { size: "md" }), _jsx(Text, { c: "dimmed", size: "sm", children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0441\u0435\u0441\u0441\u0438\u0438\u2026" })] }) }));
    }
    if (!isUnlocked) {
        return _jsx(Navigate, { to: "/login", state: { from: location }, replace: true });
    }
    return children;
}
