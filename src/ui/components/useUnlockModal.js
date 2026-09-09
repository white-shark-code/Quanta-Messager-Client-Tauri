import { useEffect } from "react";
export function useUnlockModal(open) {
    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const handler = () => {
            open();
        };
        window.addEventListener("unlock-modal:open", handler);
        return () => {
            window.removeEventListener("unlock-modal:open", handler);
        };
    }, [open]);
}
