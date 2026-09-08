import { useEffect } from "react";

export function useUnlockModal(open: () => void): void {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handler = (): void => {
      open();
    };
    window.addEventListener("unlock-modal:open", handler);
    return () => {
      window.removeEventListener("unlock-modal:open", handler);
    };
  }, [open]);
}
