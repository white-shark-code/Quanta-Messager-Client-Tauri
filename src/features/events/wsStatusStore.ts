import { create } from "zustand";

import type { WsStatus } from "./socket";

interface WsStatusState {
  status: WsStatus;
  setWsStatus: (s: WsStatus) => void;
}

/**
 * Tiny shared mirror of the active events-socket lifecycle state (T5).
 *
 * `useEventsSocket` (mounted once in `AppShellRoute`) forwards every
 * `onStatus` transition here; `SettingsRoute` reads `status` to render
 * the WS badge without mounting a second socket.
 */
export const useWsStatusStore = create<WsStatusState>((set) => ({
  status: "idle",
  setWsStatus: (status) => set({ status }),
}));

/** Imperative write helper for non-React call sites (socket callbacks). */
export function setWsStatus(status: WsStatus): void {
  useWsStatusStore.getState().setWsStatus(status);
}

/** Imperative read helper for non-React call sites. */
export function getWsStatus(): WsStatus {
  return useWsStatusStore.getState().status;
}
