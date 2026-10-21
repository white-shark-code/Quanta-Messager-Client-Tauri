// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pluginStoreState = vi.hoisted(() => {
  return { data: new Map<string, unknown>() };
});

vi.mock("@tauri-apps/plugin-store", () => {
  class LazyStore {
    init(): Promise<void> {
      return Promise.resolve();
    }

    get<T>(key: string): Promise<T | undefined> {
      if (!pluginStoreState.data.has(key)) return Promise.resolve(undefined);
      return Promise.resolve(pluginStoreState.data.get(key) as T);
    }

    set(key: string, value: unknown): Promise<void> {
      pluginStoreState.data.set(key, value);
      return Promise.resolve();
    }

    save(): Promise<void> {
      return Promise.resolve();
    }

    clear(): Promise<void> {
      pluginStoreState.data.clear();
      return Promise.resolve();
    }
  }

  return { LazyStore };
});

interface CapturedSocketOpts {
  getToken: () => string | null;
  buildUrl: (token: string) => string;
  onMessage: (m: { type: string; chat_id?: unknown }) => void;
  onStatus?: (s: string) => void;
  onUnauthorized?: () => void;
}

const socketHarness = vi.hoisted(() => {
  return {
    create: vi.fn(),
    close: vi.fn(),
    reconnect: vi.fn(),
    captured: null as CapturedSocketOpts | null,
  };
});

vi.mock("@/features/events/socket", () => ({
  createEventsSocket: (opts: CapturedSocketOpts): unknown => {
    socketHarness.create(opts);
    socketHarness.captured = opts;
    return {
      close: (...args: unknown[]): unknown => socketHarness.close(...args) as unknown,
      reconnect: (...args: unknown[]): unknown => socketHarness.reconnect(...args) as unknown,
      status: () => "open" as const,
    };
  },
}));

const bridgeMocks = vi.hoisted(() => ({
  notify: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/infra/tauriBridge", () => ({
  notify: (...args: unknown[]): unknown => bridgeMocks.notify(...args) as unknown,
  onAppEvent: (): Promise<() => void> => Promise.resolve(() => undefined),
}));

// `messages/queries` pulls the OpenPGP + dialog-store chain which cannot
// initialise under jsdom (see openpgp.mjs top-level `encodeUTF8`). The hook
// only needs `invalidateMessages(queryClient, chatId, kind)` →
// `invalidateQueries({ queryKey: ["messages", kind, chatId] })`, so stub
// that exact delegation and keep spying on the real `invalidateQueries`.
vi.mock("@/features/messages/queries", () => ({
  invalidateMessages: (
    queryClient: { invalidateQueries: (filters: unknown) => Promise<void> },
    chatId: string,
    kind = "private",
  ): Promise<void> => queryClient.invalidateQueries({ queryKey: ["messages", kind, chatId] }),
}));

import { setAccessToken } from "@/features/auth/accessToken";
import { useSessionStore } from "@/features/auth/sessionStore";
import { useSettingsStore } from "@/features/settings/settingsStore";
import { useEventsSocket } from "@/features/events/useEventsSocket";

interface TestDocumentBody {
  appendChild(node: unknown): unknown;
  innerHTML: string;
}

interface TestDocument {
  createElement(tag: string): unknown;
  body: TestDocumentBody;
}

/**
 * tests/ resolve types via tsconfig.node.json (lib ES2022, no DOM), so the
 * global `document` is untyped there. Reach the same runtime value through a
 * structural globalThis cast — no behavior change.
 */
function testDocument(): TestDocument {
  return (globalThis as unknown as { document: TestDocument }).document;
}

function mountHook(queryClient: QueryClient): { root: Root; status: { current: string } } {
  const container = testDocument().createElement("div");
  testDocument().body.appendChild(container);

  const status: { current: string } = { current: "idle" };
  const Probe = (): null => {
    status.current = useEventsSocket();
    return null;
  };

  const root = createRoot(container as Element);
  act(() => {
    root.render(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Probe)),
    );
  });
  return { root, status };
}

function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const mountedRoots: Root[] = [];

beforeEach(() => {
  socketHarness.create.mockClear();
  socketHarness.close.mockClear();
  socketHarness.reconnect.mockClear();
  socketHarness.captured = null;
  bridgeMocks.notify.mockClear();
  pluginStoreState.data.clear();

  setAccessToken(null);
  useSessionStore.setState({ user: null, isUnlocked: false, fingerprint: null });
  useSettingsStore.setState({ realtimeMode: "ws", notificationsEnabled: true });
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  testDocument().body.innerHTML = "";
  setAccessToken(null);
  useSessionStore.setState({ user: null, isUnlocked: false, fingerprint: null });
  vi.clearAllMocks();
});

describe("events/useEventsSocket", () => {
  it("does NOT create a socket while the session is locked", () => {
    const { root } = mountHook(newQueryClient());
    mountedRoots.push(root);

    expect(useSessionStore.getState().isUnlocked).toBe(false);
    expect(socketHarness.create).not.toHaveBeenCalled();
  });

  it("creates a socket when unlocked and invalidates events + private messages on new_dialog_message", () => {
    setAccessToken("tok-1");
    useSessionStore.setState({ isUnlocked: true });

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { root } = mountHook(queryClient);
    mountedRoots.push(root);

    expect(socketHarness.create).toHaveBeenCalledTimes(1);
    expect(socketHarness.captured).not.toBeNull();

    act(() => {
      socketHarness.captured?.onMessage({
        type: "new_dialog_message",
        chat_id: "chat-1",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["events"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["messages", "private", "chat-1"] });
    expect(bridgeMocks.notify).toHaveBeenCalledTimes(1);
  });

  it("invalidates the group message pages on new_group_message", () => {
    setAccessToken("tok-1");
    useSessionStore.setState({ isUnlocked: true });

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { root } = mountHook(queryClient);
    mountedRoots.push(root);

    expect(socketHarness.create).toHaveBeenCalledTimes(1);

    act(() => {
      socketHarness.captured?.onMessage({
        type: "new_group_message",
        chat_id: "group-7",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["events"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["messages", "group", "group-7"] });
  });

  it("new_dialog_chat only refreshes the chat lists (no events/messages invalidation, no notify)", () => {
    setAccessToken("tok-1");
    useSessionStore.setState({ isUnlocked: true });

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { root } = mountHook(queryClient);
    mountedRoots.push(root);

    expect(socketHarness.create).toHaveBeenCalledTimes(1);

    act(() => {
      socketHarness.captured?.onMessage({
        type: "new_dialog_chat",
        chat_id: "chat-9",
        creator_id: "u-3",
      });
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["chats"] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ["events"] });
    expect(bridgeMocks.notify).not.toHaveBeenCalled();
  });

  it("new_dialog_chat without a usable chat_id is a no-op", () => {
    setAccessToken("tok-1");
    useSessionStore.setState({ isUnlocked: true });

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { root } = mountHook(queryClient);
    mountedRoots.push(root);

    act(() => {
      socketHarness.captured?.onMessage({ type: "new_dialog_chat" });
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
