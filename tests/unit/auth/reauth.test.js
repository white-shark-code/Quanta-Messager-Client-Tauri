import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { unlockWithPassphraseMock, loginMock, meMock, updateKeystoreTokenMock, configureClientMock, setUserSpy, } = vi.hoisted(() => {
    return {
        unlockWithPassphraseMock: vi.fn(),
        loginMock: vi.fn(),
        meMock: vi.fn(),
        updateKeystoreTokenMock: vi.fn(),
        configureClientMock: vi.fn(),
        setUserSpy: vi.fn(),
    };
});
vi.mock("@/features/auth/unlock", () => {
    return {
        unlockWithPassphrase: (...args) => unlockWithPassphraseMock(...args),
    };
});
vi.mock("@/features/auth/api", () => {
    return {
        login: (...args) => loginMock(...args),
        me: (...args) => meMock(...args),
    };
});
vi.mock("@/features/secure-store/store", () => {
    return {
        updateKeystoreToken: (...args) => updateKeystoreTokenMock(...args),
        readKeystore: vi.fn(),
        writeKeystore: vi.fn(),
        upsertIndexEntry: vi.fn(),
    };
});
vi.mock("@/infra/apiClient", () => {
    return {
        configureClient: (...args) => configureClientMock(...args),
    };
});
const sessionState = vi.hoisted(() => ({
    user: null,
    isUnlocked: false,
    fingerprint: null,
}));
vi.mock("@/features/auth/sessionStore", () => {
    return {
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
                },
                setFingerprint: (fp) => {
                    sessionState.fingerprint = fp;
                },
                lock: () => {
                    sessionState.user = null;
                    sessionState.isUnlocked = false;
                    sessionState.fingerprint = null;
                },
                onUnauthorized: () => {
                    sessionState.user = null;
                    sessionState.isUnlocked = false;
                    sessionState.fingerprint = null;
                },
            }),
            setState: (partial) => Object.assign(sessionState, partial),
            subscribe: () => () => undefined,
        },
    };
});
import { reauth } from "@/features/auth/reauth";
const USER_ID = "user-99";
const USER_EMAIL = "alice@example.com";
const FAKE_TOKEN = {
    access_token: "fresh-access-token",
    token_type: "bearer",
};
const FAKE_USER = {
    id: USER_ID,
    email: USER_EMAIL,
};
const FAKE_KEYSTORE = {
    version: 1,
    user: { id: USER_ID, email: USER_EMAIL },
    accessToken: "old-token",
    privateKeyArmored: "-----BEGIN PGP PRIVATE KEY BLOCK-----\nfake\n-----END PGP PRIVATE KEY BLOCK-----",
    publicKeyArmored: "-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----",
    fingerprint: "ABCD1234",
    dialogKey: "AAECAwQFBgcICQoLDA0ODw==",
};
function setSessionUser() {
    sessionState.user = { id: USER_ID, email: USER_EMAIL };
}
describe("auth/reauth", () => {
    beforeEach(() => {
        unlockWithPassphraseMock.mockReset();
        loginMock.mockReset();
        meMock.mockReset();
        updateKeystoreTokenMock.mockReset();
        configureClientMock.mockReset();
        setUserSpy.mockReset();
        unlockWithPassphraseMock.mockResolvedValue(undefined);
        loginMock.mockResolvedValue(FAKE_TOKEN);
        meMock.mockResolvedValue(FAKE_USER);
        updateKeystoreTokenMock.mockResolvedValue(FAKE_KEYSTORE);
        sessionState.user = null;
        sessionState.isUnlocked = false;
        sessionState.fingerprint = null;
        setSessionUser();
    });
    afterEach(() => {
        vi.clearAllMocks();
    });
    it("calls unlock → login → updateKeystoreToken → configureClient → me → setUser in order", async () => {
        const callOrder = [];
        unlockWithPassphraseMock.mockImplementation(async () => {
            callOrder.push("unlock");
        });
        loginMock.mockImplementation(async () => {
            callOrder.push("login");
            return FAKE_TOKEN;
        });
        updateKeystoreTokenMock.mockImplementation(async () => {
            callOrder.push("updateKeystoreToken");
            return FAKE_KEYSTORE;
        });
        configureClientMock.mockImplementation(() => {
            callOrder.push("configureClient");
        });
        meMock.mockImplementation(async () => {
            callOrder.push("me");
            return FAKE_USER;
        });
        setUserSpy.mockImplementation(() => {
            callOrder.push("setUser");
        });
        await reauth({
            userId: USER_ID,
            keystorePassphrase: "k",
            serverPassword: "p",
        });
        expect(callOrder).toEqual([
            "unlock",
            "login",
            "updateKeystoreToken",
            "configureClient",
            "me",
            "setUser",
        ]);
    });
    it("happy path: forwards userId and keystorePassphrase to unlockWithPassphrase (no pgpPassphrase)", async () => {
        await reauth({
            userId: USER_ID,
            keystorePassphrase: "keystore-pass",
            serverPassword: "server-pass",
        });
        expect(unlockWithPassphraseMock).toHaveBeenCalledTimes(1);
        expect(unlockWithPassphraseMock).toHaveBeenCalledWith(USER_ID, "keystore-pass", undefined);
    });
    it("happy path: calls login with {username: <session email>, password: serverPassword}", async () => {
        await reauth({
            userId: USER_ID,
            keystorePassphrase: "k",
            serverPassword: "p",
        });
        expect(loginMock).toHaveBeenCalledTimes(1);
        expect(loginMock).toHaveBeenCalledWith({ username: USER_EMAIL, password: "p" });
        const loginArg = loginMock.mock.calls[0]?.[0];
        expect(loginArg).not.toHaveProperty("email");
    });
    it("happy path: persists the new access_token via updateKeystoreToken(userId, passphrase, token)", async () => {
        await reauth({
            userId: USER_ID,
            keystorePassphrase: "k",
            serverPassword: "p",
        });
        expect(updateKeystoreTokenMock).toHaveBeenCalledTimes(1);
        expect(updateKeystoreTokenMock).toHaveBeenCalledWith(USER_ID, "k", "fresh-access-token");
    });
    it("happy path: configureClient receives a tokenProvider returning the fresh access_token", async () => {
        await reauth({
            userId: USER_ID,
            keystorePassphrase: "k",
            serverPassword: "p",
        });
        expect(configureClientMock).toHaveBeenCalledTimes(1);
        const arg = configureClientMock.mock.calls[0]?.[0];
        expect(typeof arg.tokenProvider).toBe("function");
        expect(arg.tokenProvider()).toBe("fresh-access-token");
        expect(typeof arg.onUnauthorized).toBe("function");
    });
    it("happy path: hits /users/me exactly once after the token is configured", async () => {
        await reauth({
            userId: USER_ID,
            keystorePassphrase: "k",
            serverPassword: "p",
        });
        expect(meMock).toHaveBeenCalledTimes(1);
    });
    it("happy path: writes the me() result into the session store via setUser", async () => {
        await reauth({
            userId: USER_ID,
            keystorePassphrase: "k",
            serverPassword: "p",
        });
        expect(setUserSpy).toHaveBeenCalledTimes(1);
        expect(setUserSpy).toHaveBeenCalledWith({ id: USER_ID, email: USER_EMAIL });
    });
    it("forwards a separate pgpPassphrase to unlockWithPassphrase", async () => {
        await reauth({
            userId: USER_ID,
            keystorePassphrase: "keystore-pass",
            pgpPassphrase: "pgp-pass",
            serverPassword: "p",
        });
        expect(unlockWithPassphraseMock).toHaveBeenCalledTimes(1);
        expect(unlockWithPassphraseMock).toHaveBeenCalledWith(USER_ID, "keystore-pass", "pgp-pass");
    });
    it("does NOT pass pgpPassphrase when only the keystore passphrase is provided", async () => {
        await reauth({
            userId: USER_ID,
            keystorePassphrase: "keystore-pass",
            serverPassword: "p",
        });
        const unlockArgs = unlockWithPassphraseMock.mock.calls[0];
        expect(unlockArgs[0]).toBe(USER_ID);
        expect(unlockArgs[1]).toBe("keystore-pass");
        expect(unlockArgs[2]).toBeUndefined();
    });
    it("propagates login() errors verbatim (does NOT catch)", async () => {
        loginMock.mockRejectedValueOnce(new Error("Invalid credentials"));
        await expect(reauth({
            userId: USER_ID,
            keystorePassphrase: "k",
            serverPassword: "wrong",
        })).rejects.toThrow("Invalid credentials");
        expect(updateKeystoreTokenMock).not.toHaveBeenCalled();
        expect(configureClientMock).not.toHaveBeenCalled();
        expect(meMock).not.toHaveBeenCalled();
        expect(setUserSpy).not.toHaveBeenCalled();
    });
    it("propagates unlockWithPassphrase() errors verbatim (does NOT catch)", async () => {
        unlockWithPassphraseMock.mockRejectedValueOnce(new Error("Wrong passphrase"));
        await expect(reauth({
            userId: USER_ID,
            keystorePassphrase: "bad",
            serverPassword: "p",
        })).rejects.toThrow("Wrong passphrase");
        expect(loginMock).not.toHaveBeenCalled();
        expect(updateKeystoreTokenMock).not.toHaveBeenCalled();
    });
    it("propagates me() errors verbatim after the token swap", async () => {
        meMock.mockRejectedValueOnce(new Error("Server error"));
        await expect(reauth({
            userId: USER_ID,
            keystorePassphrase: "k",
            serverPassword: "p",
        })).rejects.toThrow("Server error");
        expect(updateKeystoreTokenMock).toHaveBeenCalledTimes(1);
        expect(configureClientMock).toHaveBeenCalledTimes(1);
        expect(setUserSpy).not.toHaveBeenCalled();
    });
    it("throws 'no user in session' when sessionStore has no user — never calls login", async () => {
        sessionState.user = null;
        await expect(reauth({
            userId: USER_ID,
            keystorePassphrase: "k",
            serverPassword: "p",
        })).rejects.toThrow(/no user in session/);
        expect(unlockWithPassphraseMock).not.toHaveBeenCalled();
        expect(loginMock).not.toHaveBeenCalled();
        expect(updateKeystoreTokenMock).not.toHaveBeenCalled();
        expect(configureClientMock).not.toHaveBeenCalled();
        expect(meMock).not.toHaveBeenCalled();
    });
});
