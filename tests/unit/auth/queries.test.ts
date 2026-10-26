// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  loginMock,
  registerMock,
  meMock,
  hasKeystoreMock,
  upsertIndexEntryMock,
  setUserSpy,
  setUnlockedSpy,
  setAccessTokenSpy,
  navigateMock,
} = vi.hoisted(() => ({
  loginMock: vi.fn(),
  registerMock: vi.fn(),
  meMock: vi.fn(),
  hasKeystoreMock: vi.fn(),
  upsertIndexEntryMock: vi.fn(),
  setUserSpy: vi.fn(),
  setUnlockedSpy: vi.fn(),
  setAccessTokenSpy: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("@/features/auth/api", () => ({
  login: (...args: unknown[]): unknown => loginMock(...args) as unknown,
  register: (...args: unknown[]): unknown => registerMock(...args) as unknown,
  me: (...args: unknown[]): unknown => meMock(...args) as unknown,
}));

vi.mock("@/infra/tauriBridge", () => ({
  hasKeystore: (...args: unknown[]): unknown => hasKeystoreMock(...args) as unknown,
}));

// Spy wrapper over the real accessToken module: useRegister must never
// publish a token (registration returns no Bearer), and the spy proves it.
vi.mock("@/features/auth/accessToken", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/accessToken")>();
  return {
    ...actual,
    setAccessToken: (...args: unknown[]): unknown => setAccessTokenSpy(...args) as unknown,
  };
});

vi.mock("@/features/secure-store/store", () => ({
  upsertIndexEntry: (...args: unknown[]): unknown => upsertIndexEntryMock(...args) as unknown,
  readKeystore: vi.fn(),
  writeKeystore: vi.fn(),
  updateKeystoreToken: vi.fn(),
}));

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  isUnlocked: false,
  fingerprint: null as string | null,
}));

vi.mock("@/features/auth/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({
      get user() {
        return sessionState.user;
      },
      get isUnlocked() {
        return sessionState.isUnlocked;
      },
      get fingerprint() {
        return sessionState.fingerprint;
      },
      setUser: (user: { id: string; email: string } | null) => {
        sessionState.user = user;
        setUserSpy(user);
      },
      setUnlocked: (unlocked: boolean) => {
        sessionState.isUnlocked = unlocked;
        setUnlockedSpy(unlocked);
      },
      setFingerprint: (fp: string | null) => {
        sessionState.fingerprint = fp;
      },
      lock: () => {
        sessionState.user = null;
        sessionState.isUnlocked = false;
        sessionState.fingerprint = null;
      },
      onUnauthorized: () => undefined,
    }),
    setState: (partial: Record<string, unknown>) => Object.assign(sessionState, partial),
    subscribe: () => () => undefined,
  },
  bindTokenProvider: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import { useLogin, useRegister } from "@/features/auth/queries";
import type { MeResponse } from "@/features/auth/api";
import type { RegistrationMode } from "@/features/meta/api";

const USER_ID = "user-aaa-111";
const USER_EMAIL = "alice@example.com";

const FAKE_ME: MeResponse = {
  id: USER_ID,
  email: USER_EMAIL,
};

interface ProbeHandle<T> {
  value: T | null;
  container: unknown;
  root: Root;
}

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

function mountHook<T>(useHook: () => T): ProbeHandle<T> {
  const container = testDocument().createElement("div");
  testDocument().body.appendChild(container);

  const handle: ProbeHandle<T> = {
    value: null,
    container,
    root: undefined as unknown as Root,
  };

  const Probe = (): null => {
    handle.value = useHook();
    return null;
  };

  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });

  handle.root = createRoot(container);
  act(() => {
    handle.root.render(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Probe)),
    );
  });

  return handle;
}

function mountLogin(): ProbeHandle<ReturnType<typeof useLogin>> {
  return mountHook(useLogin);
}

function mountRegister(
  mode: RegistrationMode | undefined,
): ProbeHandle<ReturnType<typeof useRegister>> {
  return mountHook(() => useRegister(mode));
}

function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  loginMock.mockReset();
  registerMock.mockReset();
  meMock.mockReset();
  hasKeystoreMock.mockReset();
  upsertIndexEntryMock.mockReset();
  setUserSpy.mockReset();
  setUnlockedSpy.mockReset();
  setAccessTokenSpy.mockReset();
  navigateMock.mockReset();

  loginMock.mockResolvedValue({ access_token: "test-token", token_type: "bearer" });
  registerMock.mockResolvedValue({ id: USER_ID, email: USER_EMAIL });
  meMock.mockResolvedValue(FAKE_ME);
  upsertIndexEntryMock.mockResolvedValue(undefined);

  sessionState.user = null;
  sessionState.isUnlocked = false;
  sessionState.fingerprint = null;
});

afterEach(() => {
  testDocument().body.innerHTML = "";
  vi.clearAllMocks();
});

describe("auth/queries — useLogin.onSuccess (multi-user flow)", () => {
  it("happy path with existing keystore: writes session, upserts index, calls hasKeystore(user.id)", async () => {
    hasKeystoreMock.mockResolvedValue(true);

    const handle = mountLogin();

    await act(async () => {
      await handle.value!.mutateAsync({ username: USER_EMAIL, password: "correct" });
      await flushMicrotasks();
    });

    expect(loginMock).toHaveBeenCalledTimes(1);
    expect(loginMock).toHaveBeenCalledWith({ username: USER_EMAIL, password: "correct" });
    expect(meMock).toHaveBeenCalledTimes(1);

    expect(setUserSpy).toHaveBeenCalledWith({ id: USER_ID, email: USER_EMAIL });
    expect(setUnlockedSpy).toHaveBeenCalledWith(true);
    expect(sessionState.user).toEqual({ id: USER_ID, email: USER_EMAIL });
    expect(sessionState.isUnlocked).toBe(true);

    expect(upsertIndexEntryMock).toHaveBeenCalledTimes(1);
    const indexArg = upsertIndexEntryMock.mock.calls[0]?.[0] as {
      userId: string;
      email: string;
      lastUsedAt: string;
    };
    expect(indexArg.userId).toBe(USER_ID);
    expect(indexArg.email).toBe(USER_EMAIL);
    expect(typeof indexArg.lastUsedAt).toBe("string");
    expect(Number.isNaN(Date.parse(indexArg.lastUsedAt))).toBe(false);

    expect(hasKeystoreMock).toHaveBeenCalledTimes(1);
    expect(hasKeystoreMock).toHaveBeenCalledWith(USER_ID);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    const [dest, opts] = navigateMock.mock.calls[0] as [string, { replace?: boolean }];
    expect(dest).toBe(`/unlock?userId=${USER_ID}`);
    expect(opts?.replace).toBe(true);
  });

  it("happy path WITHOUT existing keystore → navigates to /create-keystore?userId=<id>", async () => {
    hasKeystoreMock.mockResolvedValue(false);

    const handle = mountLogin();

    await act(async () => {
      await handle.value!.mutateAsync({ username: USER_EMAIL, password: "correct" });
      await flushMicrotasks();
    });

    expect(upsertIndexEntryMock).toHaveBeenCalledTimes(1);
    expect(hasKeystoreMock).toHaveBeenCalledTimes(1);
    expect(hasKeystoreMock).toHaveBeenCalledWith(USER_ID);
    expect(setUserSpy).toHaveBeenCalledWith({ id: USER_ID, email: USER_EMAIL });
    expect(setUnlockedSpy).toHaveBeenCalledWith(true);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    const [dest, opts] = navigateMock.mock.calls[0] as [string, { replace?: boolean }];
    expect(dest).toBe(`/create-keystore?userId=${USER_ID}`);
    expect(opts?.replace).toBe(true);
  });

  it("passes a parseable ISO-8601 timestamp with millisecond precision in lastUsedAt", async () => {
    hasKeystoreMock.mockResolvedValue(true);

    const before = Date.now();
    const handle = mountLogin();

    await act(async () => {
      await handle.value!.mutateAsync({ username: USER_EMAIL, password: "correct" });
      await flushMicrotasks();
    });
    const after = Date.now();

    const indexArg = upsertIndexEntryMock.mock.calls[0]?.[0] as { lastUsedAt: string };
    const parsed = Date.parse(indexArg.lastUsedAt);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);

    expect(indexArg.lastUsedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("login error propagates and does NOT write to the index, session, or hasKeystore", async () => {
    loginMock.mockRejectedValueOnce(new Error("Invalid credentials"));

    const handle = mountLogin();

    let caught: unknown = null;
    await act(async () => {
      try {
        await handle.value!.mutateAsync({ username: USER_EMAIL, password: "wrong" });
      } catch (e) {
        caught = e;
      }
      await flushMicrotasks();
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/Invalid credentials/);

    expect(upsertIndexEntryMock).not.toHaveBeenCalled();
    expect(hasKeystoreMock).not.toHaveBeenCalled();
    expect(setUserSpy).not.toHaveBeenCalled();
    expect(setUnlockedSpy).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(sessionState.user).toBeNull();
    expect(sessionState.isUnlocked).toBe(false);
  });
});

describe("useRegister", () => {
  it("mode=open: navigates to /setup-key and writes nothing else (register returns no token)", async () => {
    const handle = mountRegister("open");

    await act(async () => {
      await handle.value!.mutateAsync({ email: USER_EMAIL, password: "correct" });
      await flushMicrotasks();
    });

    expect(registerMock).toHaveBeenCalledTimes(1);
    // `mutationFn: authApi.register` is invoked as fn(vars, context), so
    // assert on the submitted request, not the exact call arguments.
    expect(registerMock.mock.calls[0]?.[0]).toEqual({ email: USER_EMAIL, password: "correct" });

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/setup-key");

    // Registration never yields a Bearer token and must not touch the
    // session store or the device index — only /auth/login does.
    expect(setAccessTokenSpy).not.toHaveBeenCalled();
    expect(setUserSpy).not.toHaveBeenCalled();
    expect(setUnlockedSpy).not.toHaveBeenCalled();
    expect(upsertIndexEntryMock).not.toHaveBeenCalled();
    expect(hasKeystoreMock).not.toHaveBeenCalled();
  });

  it("mode=approval: success but NO navigation and NO token/session writes (inactive account)", async () => {
    const handle = mountRegister("approval");

    await act(async () => {
      await handle.value!.mutateAsync({ email: USER_EMAIL, password: "correct" });
      await flushMicrotasks();
    });

    // The account is created INACTIVE: an admin must approve it in the DB
    // before login returns a token. The mutation itself still reports
    // success so the caller can render a "pending approval" screen.
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(handle.value!.isSuccess).toBe(true);

    // Navigating anywhere that needs a session (/setup-key, /unlock, login)
    // would 400 LOGIN_BAD_CREDENTIALS and wreck the UX — stays on register.
    expect(navigateMock).not.toHaveBeenCalled();
    expect(setAccessTokenSpy).not.toHaveBeenCalled();
    expect(setUserSpy).not.toHaveBeenCalled();
    expect(setUnlockedSpy).not.toHaveBeenCalled();
    expect(upsertIndexEntryMock).not.toHaveBeenCalled();
    expect(hasKeystoreMock).not.toHaveBeenCalled();
    expect(sessionState.user).toBeNull();
    expect(sessionState.isUnlocked).toBe(false);
  });

  it("mode=undefined falls back to approval behavior: no navigation", async () => {
    const handle = mountRegister(undefined);

    await act(async () => {
      await handle.value!.mutateAsync({ email: USER_EMAIL, password: "correct" });
      await flushMicrotasks();
    });

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(setAccessTokenSpy).not.toHaveBeenCalled();
    expect(upsertIndexEntryMock).not.toHaveBeenCalled();
  });

  it("mode=closed: no navigation (defensive — the endpoint would 403 anyway)", async () => {
    const handle = mountRegister("closed");

    await act(async () => {
      await handle.value!.mutateAsync({ email: USER_EMAIL, password: "correct" });
      await flushMicrotasks();
    });

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(setAccessTokenSpy).not.toHaveBeenCalled();
  });

  it("garbage mode string falls back to approval behavior: no navigation", async () => {
    const handle = mountRegister("whatever" as unknown as RegistrationMode);

    await act(async () => {
      await handle.value!.mutateAsync({ email: USER_EMAIL, password: "correct" });
      await flushMicrotasks();
    });

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(setAccessTokenSpy).not.toHaveBeenCalled();
    expect(upsertIndexEntryMock).not.toHaveBeenCalled();
  });
});
