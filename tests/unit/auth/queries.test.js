// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { loginMock, meMock, hasKeystoreMock, upsertIndexEntryMock, setUserSpy, setUnlockedSpy, navigateMock, } = vi.hoisted(() => ({
    loginMock: vi.fn(),
    meMock: vi.fn(),
    hasKeystoreMock: vi.fn(),
    upsertIndexEntryMock: vi.fn(),
    setUserSpy: vi.fn(),
    setUnlockedSpy: vi.fn(),
    navigateMock: vi.fn(),
}));
vi.mock("@/features/auth/api", () => ({
    login: (...args) => loginMock(...args),
    me: (...args) => meMock(...args),
}));
vi.mock("@/infra/tauriBridge", () => ({
    hasKeystore: (...args) => hasKeystoreMock(...args),
}));
vi.mock("@/features/secure-store/store", () => ({
    upsertIndexEntry: (...args) => upsertIndexEntryMock(...args),
    readKeystore: vi.fn(),
    writeKeystore: vi.fn(),
    updateKeystoreToken: vi.fn(),
}));
const sessionState = vi.hoisted(() => ({
    user: null,
    isUnlocked: false,
    fingerprint: null,
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
            setUser: (user) => {
                sessionState.user = user;
                setUserSpy(user);
            },
            setUnlocked: (unlocked) => {
                sessionState.isUnlocked = unlocked;
                setUnlockedSpy(unlocked);
            },
            setFingerprint: (fp) => {
                sessionState.fingerprint = fp;
            },
            lock: () => {
                sessionState.user = null;
                sessionState.isUnlocked = false;
                sessionState.fingerprint = null;
            },
            onUnauthorized: () => undefined,
        }),
        setState: (partial) => Object.assign(sessionState, partial),
        subscribe: () => () => undefined,
    },
    bindTokenProvider: vi.fn(),
}));
vi.mock("react-router-dom", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});
import { useLogin } from "@/features/auth/queries";
const USER_ID = "user-aaa-111";
const USER_EMAIL = "alice@example.com";
const FAKE_ME = {
    id: USER_ID,
    email: USER_EMAIL,
};
function mountLogin(_initialPath = "/") {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const handle = {
        value: null,
        container,
        root: undefined,
    };
    const Probe = () => {
        handle.value = useLogin();
        return null;
    };
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });
    handle.root = createRoot(container);
    act(() => {
        handle.root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Probe)));
    });
    return handle;
}
function flushMicrotasks() {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}
beforeEach(() => {
    loginMock.mockReset();
    meMock.mockReset();
    hasKeystoreMock.mockReset();
    upsertIndexEntryMock.mockReset();
    setUserSpy.mockReset();
    setUnlockedSpy.mockReset();
    navigateMock.mockReset();
    loginMock.mockResolvedValue({ access_token: "test-token", token_type: "bearer" });
    meMock.mockResolvedValue(FAKE_ME);
    upsertIndexEntryMock.mockResolvedValue(undefined);
    sessionState.user = null;
    sessionState.isUnlocked = false;
    sessionState.fingerprint = null;
});
afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
});
describe("auth/queries — useLogin.onSuccess (multi-user flow)", () => {
    it("happy path with existing keystore: writes session, upserts index, calls hasKeystore(user.id)", async () => {
        hasKeystoreMock.mockResolvedValue(true);
        const handle = mountLogin("/");
        await act(async () => {
            await handle.value.mutateAsync({ username: USER_EMAIL, password: "correct" });
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
        const indexArg = upsertIndexEntryMock.mock.calls[0]?.[0];
        expect(indexArg.userId).toBe(USER_ID);
        expect(indexArg.email).toBe(USER_EMAIL);
        expect(typeof indexArg.lastUsedAt).toBe("string");
        expect(Number.isNaN(Date.parse(indexArg.lastUsedAt))).toBe(false);
        expect(hasKeystoreMock).toHaveBeenCalledTimes(1);
        expect(hasKeystoreMock).toHaveBeenCalledWith(USER_ID);
        expect(navigateMock).toHaveBeenCalledTimes(1);
        const [dest, opts] = navigateMock.mock.calls[0];
        expect(dest).toBe(`/unlock?userId=${USER_ID}`);
        expect(opts?.replace).toBe(true);
    });
    it("happy path WITHOUT existing keystore → navigates to /create-keystore?userId=<id>", async () => {
        hasKeystoreMock.mockResolvedValue(false);
        const handle = mountLogin("/");
        await act(async () => {
            await handle.value.mutateAsync({ username: USER_EMAIL, password: "correct" });
            await flushMicrotasks();
        });
        expect(upsertIndexEntryMock).toHaveBeenCalledTimes(1);
        expect(hasKeystoreMock).toHaveBeenCalledTimes(1);
        expect(hasKeystoreMock).toHaveBeenCalledWith(USER_ID);
        expect(setUserSpy).toHaveBeenCalledWith({ id: USER_ID, email: USER_EMAIL });
        expect(setUnlockedSpy).toHaveBeenCalledWith(true);
        expect(navigateMock).toHaveBeenCalledTimes(1);
        const [dest, opts] = navigateMock.mock.calls[0];
        expect(dest).toBe(`/create-keystore?userId=${USER_ID}`);
        expect(opts?.replace).toBe(true);
    });
    it("passes a parseable ISO-8601 timestamp with millisecond precision in lastUsedAt", async () => {
        hasKeystoreMock.mockResolvedValue(true);
        const before = Date.now();
        const handle = mountLogin("/");
        await act(async () => {
            await handle.value.mutateAsync({ username: USER_EMAIL, password: "correct" });
            await flushMicrotasks();
        });
        const after = Date.now();
        const indexArg = upsertIndexEntryMock.mock.calls[0]?.[0];
        const parsed = Date.parse(indexArg.lastUsedAt);
        expect(parsed).toBeGreaterThanOrEqual(before);
        expect(parsed).toBeLessThanOrEqual(after);
        expect(indexArg.lastUsedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
    it("login error propagates and does NOT write to the index, session, or hasKeystore", async () => {
        loginMock.mockRejectedValueOnce(new Error("Invalid credentials"));
        const handle = mountLogin("/");
        let caught = null;
        await act(async () => {
            try {
                await handle.value.mutateAsync({ username: USER_EMAIL, password: "wrong" });
            }
            catch (e) {
                caught = e;
            }
            await flushMicrotasks();
        });
        expect(caught).toBeInstanceOf(Error);
        expect(caught.message).toMatch(/Invalid credentials/);
        expect(upsertIndexEntryMock).not.toHaveBeenCalled();
        expect(hasKeystoreMock).not.toHaveBeenCalled();
        expect(setUserSpy).not.toHaveBeenCalled();
        expect(setUnlockedSpy).not.toHaveBeenCalled();
        expect(navigateMock).not.toHaveBeenCalled();
        expect(sessionState.user).toBeNull();
        expect(sessionState.isUnlocked).toBe(false);
    });
});
