import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { configureClientMock } = vi.hoisted(() => ({
  configureClientMock: vi.fn(),
}));

vi.mock("@/infra/apiClient", () => {
  return {
    configureClient: (...args: unknown[]): unknown => configureClientMock(...args) as unknown,
  };
});

import { useSessionStore } from "@/features/auth/sessionStore";

const SESSION_MODULE_INITIAL_CALLS = 1;

describe("auth/sessionStore", () => {
  beforeEach(() => {
    configureClientMock.mockClear();
  });

  afterEach(() => {
    useSessionStore.setState({ user: null, isUnlocked: false, fingerprint: null });
    vi.clearAllMocks();
  });

  it("starts with default state (null user, locked, no fingerprint)", () => {
    const fresh = useSessionStore.getState();
    expect(fresh.user).toBeNull();
    expect(fresh.isUnlocked).toBe(false);
    expect(fresh.fingerprint).toBeNull();
  });

  it("setUser({id,email}) updates the user field", () => {
    useSessionStore.getState().setUser({ id: "u-1", email: "alice@example.com" });
    expect(useSessionStore.getState().user).toEqual({
      id: "u-1",
      email: "alice@example.com",
    });
  });

  it("setUser(null) resets the user to null without touching other fields", () => {
    useSessionStore.getState().setUser({ id: "u-1", email: "alice@example.com" });
    useSessionStore.getState().setUnlocked(true);
    useSessionStore.getState().setFingerprint("ABCD");

    useSessionStore.getState().setUser(null);

    const state = useSessionStore.getState();
    expect(state.user).toBeNull();
    expect(state.isUnlocked).toBe(true);
    expect(state.fingerprint).toBe("ABCD");
  });

  it("setUnlocked(true) updates the isUnlocked flag", () => {
    useSessionStore.getState().setUnlocked(true);
    expect(useSessionStore.getState().isUnlocked).toBe(true);
  });

  it("setUnlocked(false) updates the isUnlocked flag back to false", () => {
    useSessionStore.getState().setUnlocked(true);
    useSessionStore.getState().setUnlocked(false);
    expect(useSessionStore.getState().isUnlocked).toBe(false);
  });

  it("setFingerprint('ABCD') updates the fingerprint", () => {
    useSessionStore.getState().setFingerprint("ABCD1234");
    expect(useSessionStore.getState().fingerprint).toBe("ABCD1234");
  });

  it("setFingerprint(null) clears the fingerprint", () => {
    useSessionStore.getState().setFingerprint("ABCD1234");
    useSessionStore.getState().setFingerprint(null);
    expect(useSessionStore.getState().fingerprint).toBeNull();
  });

  it("lock() resets user, isUnlocked, and fingerprint", () => {
    useSessionStore.getState().setUser({ id: "u-1", email: "alice@example.com" });
    useSessionStore.getState().setUnlocked(true);
    useSessionStore.getState().setFingerprint("DEADBEEF");

    useSessionStore.getState().lock();

    const state = useSessionStore.getState();
    expect(state.user).toBeNull();
    expect(state.isUnlocked).toBe(false);
    expect(state.fingerprint).toBeNull();
  });

  it("onUnauthorized() also resets all three fields (same as lock)", () => {
    useSessionStore.getState().setUser({ id: "u-2", email: "bob@example.com" });
    useSessionStore.getState().setUnlocked(true);
    useSessionStore.getState().setFingerprint("FACEFEED");

    useSessionStore.getState().onUnauthorized();

    const state = useSessionStore.getState();
    expect(state.user).toBeNull();
    expect(state.isUnlocked).toBe(false);
    expect(state.fingerprint).toBeNull();
  });

  it("bindTokenProvider wires configureClient with a tokenProvider and onUnauthorized=lock", async () => {
    vi.resetModules();
    configureClientMock.mockClear();

    const tokenProvider = vi.fn(() => "bound-token");
    const sessionStoreModule = await import("@/features/auth/sessionStore");

    expect(configureClientMock).toHaveBeenCalledTimes(SESSION_MODULE_INITIAL_CALLS);

    sessionStoreModule.bindTokenProvider(tokenProvider);

    expect(configureClientMock).toHaveBeenCalledTimes(SESSION_MODULE_INITIAL_CALLS + 1);
    const lastCallIdx = configureClientMock.mock.calls.length - 1;
    const arg = configureClientMock.mock.calls[lastCallIdx]?.[0] as {
      tokenProvider: () => string | null;
      onUnauthorized: () => void;
    };
    expect(typeof arg.tokenProvider).toBe("function");
    expect(arg.tokenProvider()).toBe("bound-token");
    expect(typeof arg.onUnauthorized).toBe("function");

    const beforeUser = sessionStoreModule.useSessionStore.getState().user;
    expect(beforeUser).toBeNull();
    sessionStoreModule.useSessionStore.getState().setUser({ id: "x", email: "y" });
    sessionStoreModule.useSessionStore.getState().setUnlocked(true);
    sessionStoreModule.useSessionStore.getState().setFingerprint("FF");

    arg.onUnauthorized();

    const after = sessionStoreModule.useSessionStore.getState();
    expect(after.user).toBeNull();
    expect(after.isUnlocked).toBe(false);
    expect(after.fingerprint).toBeNull();
  });

  it("configures apiClient with tokenProvider returning null at module load time", async () => {
    vi.resetModules();
    configureClientMock.mockClear();

    await import("@/features/auth/sessionStore");

    expect(configureClientMock).toHaveBeenCalledTimes(SESSION_MODULE_INITIAL_CALLS);
    const arg = configureClientMock.mock.calls[0]?.[0] as {
      tokenProvider: () => string | null;
      onUnauthorized: () => void;
    };
    expect(arg.tokenProvider()).toBeNull();
    expect(typeof arg.onUnauthorized).toBe("function");
  });
});
