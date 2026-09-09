import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { RouterProvider } from "react-router-dom";
import "@mantine/core/styles.css";
import "./i18n";
import i18n, { LANGUAGE_STORAGE_KEY } from "./i18n";
import { router } from "./routes";
import { theme } from "./ui/theme";
import { queryClient } from "./infra/queryClient";
import { UnlockAgainModal } from "@/ui/components/UnlockAgainModal";
import { useIdleTimeout } from "@/features/auth/useIdleTimeout";
import { useSettingsStore } from "@/features/settings/settingsStore";
function IdleTimeoutWrapper({ children }) {
    useIdleTimeout();
    return _jsx(_Fragment, { children: children });
}
function I18nSync() {
    useEffect(() => {
        const sync = (lang) => {
            console.log("[i18n] sync called with", lang);
            void i18n.changeLanguage(lang).then(() => {
                console.log("[i18n] changeLanguage resolved:", i18n.language);
            });
            try {
                localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
            }
            catch {
                // ignore storage errors (private mode, quota, etc.)
            }
        };
        sync(useSettingsStore.getState().language);
        const unsubscribe = useSettingsStore.subscribe((state, prevState) => {
            if (state.language !== prevState.language) {
                sync(state.language);
            }
        });
        return unsubscribe;
    }, []);
    return null;
}
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: _jsx(QueryClientProvider, { client: queryClient, children: _jsxs(MantineProvider, { theme: theme, defaultColorScheme: "dark", children: [_jsx(I18nSync, {}), _jsx(IdleTimeoutWrapper, { children: _jsx(RouterProvider, { router: router }) }), _jsx(UnlockAgainModal, {})] }) }) }));
