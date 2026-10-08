// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storeState = vi.hoisted(() => {
  return { data: new Map<string, unknown>() };
});

vi.mock("@tauri-apps/plugin-store", () => {
  class LazyStore {
    init(): Promise<void> {
      return Promise.resolve();
    }

    get<T>(key: string): Promise<T | undefined> {
      if (!storeState.data.has(key)) return Promise.resolve(undefined);
      return Promise.resolve(storeState.data.get(key) as T);
    }

    set(key: string, value: unknown): Promise<void> {
      storeState.data.set(key, value);
      return Promise.resolve();
    }

    save(): Promise<void> {
      return Promise.resolve();
    }

    clear(): Promise<void> {
      storeState.data.clear();
      return Promise.resolve();
    }
  }

  return { LazyStore };
});

const bridgeMocks = vi.hoisted(() => ({
  hasKeystore: vi.fn(),
  ensureNotificationPermission: vi.fn(),
}));

vi.mock("@/infra/tauriBridge", () => {
  return {
    hasKeystore: (...args: unknown[]): unknown => bridgeMocks.hasKeystore(...args) as unknown,
    ensureNotificationPermission: (...args: unknown[]): unknown =>
      bridgeMocks.ensureNotificationPermission(...args) as unknown,
  };
});

const pushMocks = vi.hoisted(() => ({
  ensurePushSubscription: vi.fn(),
  unsubscribePushSubscription: vi.fn(),
}));

vi.mock("@/features/push/subscription", () => {
  return {
    ensurePushSubscription: (...args: unknown[]): unknown =>
      pushMocks.ensurePushSubscription(...args) as unknown,
    unsubscribePushSubscription: (...args: unknown[]): unknown =>
      pushMocks.unsubscribePushSubscription(...args) as unknown,
  };
});

const {
  readKeystoreMock,
  importPrivateKeyMock,
  importPublicKeyMock,
  setKeysMock,
  configureClientMock,
  debugLogMock,
} = vi.hoisted(() => ({
  readKeystoreMock: vi.fn(),
  importPrivateKeyMock: vi.fn(),
  importPublicKeyMock: vi.fn(),
  setKeysMock: vi.fn(),
  configureClientMock: vi.fn(),
  debugLogMock: vi.fn(),
}));

vi.mock("@/features/secure-store/store", () => {
  return {
    readKeystore: (...args: unknown[]): unknown => readKeystoreMock(...args) as unknown,
    upsertIndexEntry: vi.fn(),
  };
});

vi.mock("@/features/keyring/encrypt", () => {
  return {
    importPrivateKey: (...args: unknown[]): unknown => importPrivateKeyMock(...args) as unknown,
    importPublicKey: (...args: unknown[]): unknown => importPublicKeyMock(...args) as unknown,
  };
});

vi.mock("@/features/keyring/keyringStore", () => {
  return {
    useKeyringStore: {
      getState: () => ({
        setKeys: (...args: unknown[]): unknown => setKeysMock(...args) as unknown,
      }),
    },
  };
});

vi.mock("@/infra/apiClient", () => {
  return {
    configureClient: (...args: unknown[]): unknown => configureClientMock(...args) as unknown,
  };
});

vi.mock("@/lib/debug", () => {
  return {
    debugLog: (...args: unknown[]): unknown => debugLogMock(...args) as unknown,
  };
});

import { useSettingsStore } from "@/features/settings/settingsStore";
import { useSessionStore } from "@/features/auth/sessionStore";
import { unlockWithPassphrase } from "@/features/auth/unlock";
import { usePushToggle, type PushToggleResult } from "@/features/push/usePushToggle";
import type { KeystorePayload } from "@/features/secure-store/types";

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

type PushHandle = ReturnType<typeof usePushToggle>;

let latestHandle: PushHandle | null = null;

function currentHandle(): PushHandle {
  if (latestHandle === null) {
    throw new Error("push probe did not render");
  }
  return latestHandle;
}

const mountedRoots: Root[] = [];

function mountProbe(): void {
  latestHandle = null;
  const container = testDocument().createElement("div");
  testDocument().body.appendChild(container);
  const Probe = (): null => {
    latestHandle = usePushToggle();
    return null;
  };
  const root = createRoot(container as Element);
  mountedRoots.push(root);
  act(() => {
    root.render(React.createElement(Probe));
  });
}

const USER_A = "user-aaa-111";

const FAKE_PAYLOAD: KeystorePayload = {
  version: 1,
  user: { id: USER_A, email: "alice@example.com" },
  accessToken: "bearer-from-keystore",
  privateKeyArmored:
    "-----BEGIN PGP PRIVATE KEY BLOCK-----\nfake\n-----END PGP PRIVATE KEY BLOCK-----\n",
  publicKeyArmored:
    "-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----\n",
  fingerprint: "DEADBEEFCAFEBABE",
  dialogKey: "AAECAwQFBgcICQoLDA0ODw==",
};

beforeEach(async () => {
  storeState.data.clear();
  pushMocks.ensurePushSubscription.mockReset();
  pushMocks.unsubscribePushSubscription.mockReset();
  bridgeMocks.hasKeystore.mockReset();
  bridgeMocks.ensureNotificationPermission.mockReset();
  readKeystoreMock.mockReset();
  importPrivateKeyMock.mockReset();
  importPublicKeyMock.mockReset();
  setKeysMock.mockReset();
  configureClientMock.mockReset();
  debugLogMock.mockReset();

  bridgeMocks.ensureNotificationPermission.mockResolvedValue(true);
  pushMocks.ensurePushSubscription.mockResolvedValue({
    subscribed: true,
    endpoint: "https://push.example/s1",
  });
  pushMocks.unsubscribePushSubscription.mockResolvedValue({
    unsubscribed: true,
    endpoint: "https://push.example/s1",
  });
  bridgeMocks.hasKeystore.mockResolvedValue(true);
  readKeystoreMock.mockResolvedValue(FAKE_PAYLOAD);
  importPrivateKeyMock.mockResolvedValue({ isDecrypted: () => true });
  importPublicKeyMock.mockResolvedValue({ getFingerprint: () => "DEADBEEFCAFEBABE" });
  setKeysMock.mockResolvedValue(undefined);
  debugLogMock.mockResolvedValue(undefined);

  await useSettingsStore.getState().reset();
  useSettingsStore.setState({ hydrated: false });
  useSessionStore.setState({ user: null, isUnlocked: false, fingerprint: null });
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  testDocument().body.innerHTML = "";
});

describe("push/settings (B2)", () => {
  it("defaults pushEnabled to false", () => {
    expect(useSettingsStore.getState().pushEnabled).toBe(false);
  });

  it("hydrate() drops a non-boolean pushEnabled so the default wins", async () => {
    storeState.data.set("pushEnabled", "yes");
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().pushEnabled).toBe(false);
  });

  it("hydrate() keeps a persisted pushEnabled=true", async () => {
    storeState.data.set("pushEnabled", true);
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().hydrated).toBe(true);
    expect(useSettingsStore.getState().pushEnabled).toBe(true);
  });

  it("togglePush(true) subscribes and persists pushEnabled=true", async () => {
    mountProbe();
    expect(currentHandle().pushEnabled).toBe(false);

    let result: PushToggleResult | undefined;
    await act(async () => {
      result = await currentHandle().togglePush(true);
    });

    expect(result).toEqual({ ok: true });
    expect(useSettingsStore.getState().pushEnabled).toBe(true);
    expect(currentHandle().reason).toBeNull();
    expect(pushMocks.ensurePushSubscription).toHaveBeenCalledTimes(1);
  });

  it("togglePush(true) on denied permission writes nothing and reports denied", async () => {
    bridgeMocks.ensureNotificationPermission.mockResolvedValueOnce(false);
    mountProbe();

    let result: PushToggleResult | undefined;
    await act(async () => {
      result = await currentHandle().togglePush(true);
    });

    expect(result).toEqual({ ok: false, reason: "denied" });
    expect(useSettingsStore.getState().pushEnabled).toBe(false);
    expect(pushMocks.ensurePushSubscription).not.toHaveBeenCalled();
    expect(currentHandle().reason).toBe("denied");
  });

  it("togglePush(true) on no-vapid persists false and surfaces the reason", async () => {
    pushMocks.ensurePushSubscription.mockResolvedValueOnce({
      subscribed: false,
      reason: "no-vapid",
    });
    mountProbe();

    let result: PushToggleResult | undefined;
    await act(async () => {
      result = await currentHandle().togglePush(true);
    });

    expect(result).toEqual({ ok: false, reason: "no-vapid" });
    expect(useSettingsStore.getState().pushEnabled).toBe(false);
    expect(currentHandle().reason).toBe("no-vapid");
  });

  it("togglePush(true) converts a subscribe throw into {ok:false} without throwing", async () => {
    pushMocks.ensurePushSubscription.mockRejectedValueOnce(new Error("offline"));
    mountProbe();

    let result: PushToggleResult | undefined;
    await act(async () => {
      result = await currentHandle().togglePush(true);
    });

    expect(result).toEqual({ ok: false, reason: "offline" });
    expect(useSettingsStore.getState().pushEnabled).toBe(false);
  });

  it("togglePush(false) unsubscribes and persists pushEnabled=false", async () => {
    mountProbe();

    await act(async () => {
      await currentHandle().togglePush(true);
    });
    expect(useSettingsStore.getState().pushEnabled).toBe(true);

    let result: PushToggleResult | undefined;
    await act(async () => {
      result = await currentHandle().togglePush(false);
    });

    expect(result).toEqual({ ok: true });
    expect(pushMocks.unsubscribePushSubscription).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().pushEnabled).toBe(false);
    expect(currentHandle().reason).toBeNull();
  });

  it("togglePush(false) on unsubscribe failure keeps pushEnabled so the user can retry", async () => {
    await useSettingsStore.getState().set("pushEnabled", true);
    pushMocks.unsubscribePushSubscription.mockRejectedValueOnce(new Error("net down"));
    mountProbe();

    let result: PushToggleResult | undefined;
    await act(async () => {
      result = await currentHandle().togglePush(false);
    });

    expect(result).toEqual({ ok: false, reason: "net down" });
    expect(useSettingsStore.getState().pushEnabled).toBe(true);
  });

  it("unlock does not touch push when pushEnabled is false", async () => {
    await unlockWithPassphrase(USER_A, "keystore-pass");
    expect(useSessionStore.getState().isUnlocked).toBe(true);
    expect(pushMocks.ensurePushSubscription).not.toHaveBeenCalled();
  });

  it("unlock re-subscribes best-effort when pushEnabled is true", async () => {
    await useSettingsStore.getState().set("pushEnabled", true);
    await unlockWithPassphrase(USER_A, "keystore-pass");
    expect(pushMocks.ensurePushSubscription).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().isUnlocked).toBe(true);
  });

  it("unlock is not blocked by a still-pending push subscription", async () => {
    await useSettingsStore.getState().set("pushEnabled", true);
    pushMocks.ensurePushSubscription.mockReturnValueOnce(
      new Promise<unknown>(() => {
        // Never settles — proves unlock() doesn't await the re-subscribe.
      }),
    );
    await unlockWithPassphrase(USER_A, "keystore-pass");
    expect(pushMocks.ensurePushSubscription).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().isUnlocked).toBe(true);
  });

  it("a failing push re-subscribe does not fail unlock and is debug-logged", async () => {
    await useSettingsStore.getState().set("pushEnabled", true);
    pushMocks.ensurePushSubscription.mockRejectedValueOnce(new Error("boom"));
    await unlockWithPassphrase(USER_A, "keystore-pass");
    expect(useSessionStore.getState().isUnlocked).toBe(true);
    await vi.waitFor(() => {
      expect(debugLogMock).toHaveBeenCalledWith("push.resubscribe", expect.any(Error));
    });
  });
});
