import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMeta, subscribePush, unsubscribePush } from "@/features/push/api";
import {
  ensurePushSubscription,
  unsubscribePushSubscription,
  urlBase64ToUint8Array,
} from "@/features/push/subscription";

vi.mock("@/features/push/api", () => ({
  getMeta: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

const getMetaMock = vi.mocked(getMeta);
const subscribePushMock = vi.mocked(subscribePush);
const unsubscribePushMock = vi.mocked(unsubscribePush);

function bytesToBuffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function fakeSubscription(options?: { p256dh?: ArrayBuffer | null; auth?: ArrayBuffer | null }) {
  const keys = {
    p256dh: options?.p256dh === undefined ? bytesToBuffer([1, 2, 3]) : options.p256dh,
    auth: options?.auth === undefined ? bytesToBuffer([4, 5, 6]) : options.auth,
  };
  return {
    endpoint: "https://push.example/sub-1",
    getKey: vi.fn((name: string) => keys[name as keyof typeof keys]),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

type FakeSubscription = ReturnType<typeof fakeSubscription>;

function stubPushManager(pushManager: unknown, registrationExtra?: Record<string, unknown>) {
  const registration = { pushManager, ...registrationExtra };
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  });
  return registration;
}

beforeEach(() => {
  vi.stubGlobal("Notification", { permission: "granted" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("push/subscription — urlBase64ToUint8Array", () => {
  it("decodes standard base64", () => {
    // "AQID" is the canonical base64 of bytes [1, 2, 3].
    expect(urlBase64ToUint8Array("AQID")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("adds missing padding", () => {
    expect(urlBase64ToUint8Array("AQ")).toEqual(new Uint8Array([1]));
  });

  it("decodes URL-safe alphabet (-_ instead of +/)", () => {
    // "-_A" + "=" → "+/A=" → bytes [251, 240].
    expect(urlBase64ToUint8Array("-_A")).toEqual(new Uint8Array([251, 240]));
  });
});

describe("push/subscription — ensurePushSubscription", () => {
  it("returns denied when Notification permission is not granted", async () => {
    vi.stubGlobal("Notification", { permission: "denied" });
    stubPushManager({ getSubscription: vi.fn() });

    const result = await ensurePushSubscription();

    expect(result).toEqual({ subscribed: false, reason: "denied" });
    expect(getMetaMock).not.toHaveBeenCalled();
  });

  it("returns denied when Notification permission is still default", async () => {
    vi.stubGlobal("Notification", { permission: "default" });
    stubPushManager({ getSubscription: vi.fn() });

    expect(await ensurePushSubscription()).toEqual({ subscribed: false, reason: "denied" });
  });

  it("returns no-service-worker when Service Worker is unavailable", async () => {
    vi.stubGlobal("navigator", {});

    expect(await ensurePushSubscription()).toEqual({
      subscribed: false,
      reason: "no-service-worker",
    });
    expect(getMetaMock).not.toHaveBeenCalled();
  });

  it("returns no-vapid when GET /meta yields an empty key", async () => {
    const subscribe = vi.fn();
    stubPushManager({ getSubscription: vi.fn().mockResolvedValue(null), subscribe });
    getMetaMock.mockResolvedValue({ vapid_public_key: "" });

    const result = await ensurePushSubscription();

    expect(result).toEqual({ subscribed: false, reason: "no-vapid" });
    expect(subscribe).not.toHaveBeenCalled();
    expect(subscribePushMock).not.toHaveBeenCalled();
  });

  it("reuses the existing subscription and registers it on the backend", async () => {
    const subscription = fakeSubscription();
    stubPushManager({ getSubscription: vi.fn().mockResolvedValue(subscription) });
    getMetaMock.mockResolvedValue({ vapid_public_key: "AQID" });
    subscribePushMock.mockResolvedValue({ endpoint: subscription.endpoint });

    const result = await ensurePushSubscription();

    expect(result).toEqual({ subscribed: true, endpoint: subscription.endpoint });
    expect(subscribePushMock).toHaveBeenCalledTimes(1);
    // [1,2,3] → "AQID", [4,5,6] → "BAUG" (base64url).
    expect(subscribePushMock).toHaveBeenCalledWith(subscription.endpoint, "AQID", "BAUG");
  });

  it("creates a subscription with userVisibleOnly + VAPID key when none exists", async () => {
    const subscription = fakeSubscription();
    const subscribe = vi.fn().mockResolvedValue(subscription);
    stubPushManager({ getSubscription: vi.fn().mockResolvedValue(null), subscribe });
    getMetaMock.mockResolvedValue({ vapid_public_key: "AQID" });
    subscribePushMock.mockResolvedValue({ endpoint: subscription.endpoint });

    const result = await ensurePushSubscription();

    expect(result).toEqual({ subscribed: true, endpoint: subscription.endpoint });
    expect(subscribe).toHaveBeenCalledTimes(1);
    const options = subscribe.mock.calls[0]?.[0] as
      | { userVisibleOnly: boolean; applicationServerKey: unknown }
      | undefined;
    expect(options?.userVisibleOnly).toBe(true);
    expect(options?.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(options?.applicationServerKey).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("registers /sw.js on demand when nothing is registered yet", async () => {
    const subscription = fakeSubscription();
    const register = vi.fn().mockResolvedValue({ pushManager: null });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) },
        }),
        getRegistration: vi.fn().mockResolvedValue(undefined),
        register,
      },
    });
    getMetaMock.mockResolvedValue({ vapid_public_key: "AQID" });
    subscribePushMock.mockResolvedValue({ endpoint: subscription.endpoint });

    const result = await ensurePushSubscription();

    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(result).toEqual({ subscribed: true, endpoint: subscription.endpoint });
  });

  it("returns subscribe-failed when PushManager.subscribe hangs past the timeout", async () => {
    vi.useFakeTimers();
    try {
      stubPushManager({
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(resolve, 3_600_000);
            }),
        ),
      });
      getMetaMock.mockResolvedValue({ vapid_public_key: "AQID" });

      const pending = ensurePushSubscription();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(await pending).toEqual({ subscribed: false, reason: "subscribe-failed" });
      expect(subscribePushMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns subscribe-failed when PushManager.subscribe throws", async () => {
    stubPushManager({
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockRejectedValue(new Error("denied")),
    });
    getMetaMock.mockResolvedValue({ vapid_public_key: "AQID" });

    expect(await ensurePushSubscription()).toEqual({
      subscribed: false,
      reason: "subscribe-failed",
    });
    expect(subscribePushMock).not.toHaveBeenCalled();
  });

  it("returns no-keys when the subscription exposes no crypto keys", async () => {
    const subscription = fakeSubscription({ p256dh: null, auth: null });
    stubPushManager({ getSubscription: vi.fn().mockResolvedValue(subscription) });
    getMetaMock.mockResolvedValue({ vapid_public_key: "AQID" });

    expect(await ensurePushSubscription()).toEqual({ subscribed: false, reason: "no-keys" });
    expect(subscribePushMock).not.toHaveBeenCalled();
  });
});

describe("push/subscription — unsubscribePushSubscription", () => {
  it("deletes the endpoint on the backend and unsubscribes locally", async () => {
    const subscription: FakeSubscription = fakeSubscription();
    stubPushManager({
      getSubscription: vi.fn().mockResolvedValue(subscription as unknown as PushSubscription),
    });
    unsubscribePushMock.mockResolvedValue(undefined);

    const result = await unsubscribePushSubscription();

    expect(result).toEqual({ unsubscribed: true, endpoint: subscription.endpoint });
    expect(unsubscribePushMock).toHaveBeenCalledTimes(1);
    expect(unsubscribePushMock).toHaveBeenCalledWith(subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("returns no-subscription when nothing is subscribed (idempotent)", async () => {
    stubPushManager({ getSubscription: vi.fn().mockResolvedValue(null) });

    expect(await unsubscribePushSubscription()).toEqual({
      unsubscribed: false,
      reason: "no-subscription",
    });
    expect(unsubscribePushMock).not.toHaveBeenCalled();
  });

  it("returns no-service-worker when Service Worker is unavailable", async () => {
    vi.stubGlobal("navigator", {});

    expect(await unsubscribePushSubscription()).toEqual({
      unsubscribed: false,
      reason: "no-service-worker",
    });
    expect(unsubscribePushMock).not.toHaveBeenCalled();
  });
});
