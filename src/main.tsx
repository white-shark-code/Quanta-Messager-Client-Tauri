import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { RouterProvider } from "react-router-dom";

import "@mantine/core/styles.css";

import i18n, { LANGUAGE_STORAGE_KEY } from "./i18n";
import { router } from "./routes";
import { theme } from "./ui/theme";
import { queryClient } from "./infra/queryClient";
import { UnlockAgainModal } from "@/ui/components/UnlockAgainModal";
import { useIdleTimeout } from "@/features/auth/useIdleTimeout";
import { useSettingsStore } from "@/features/settings/settingsStore";

function IdleTimeoutWrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  useIdleTimeout();
  return <>{children}</>;
}

function I18nSync(): null {
  useEffect(() => {
    const sync = (lang: "en" | "ru" | "vi"): void => {
      console.log("[i18n] sync called with", lang);
      void i18n.changeLanguage(lang).then(() => {
        console.log("[i18n] changeLanguage resolved:", i18n.language);
      });
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      } catch {
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <I18nSync />
        <IdleTimeoutWrapper>
          <RouterProvider router={router} />
        </IdleTimeoutWrapper>
        <UnlockAgainModal />
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
