import { afterEach, describe, expect, it, vi } from "vitest";

import { isPushApiAvailable } from "@/features/push/support";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("push/support — isPushApiAvailable", () => {
  it("returns true when Service Worker and PushManager exist", () => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("PushManager", Object);
    expect(isPushApiAvailable()).toBe(true);
  });

  it("returns false without Service Worker", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("PushManager", Object);
    expect(isPushApiAvailable()).toBe(false);
  });

  it("returns false without PushManager", () => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("PushManager", undefined);
    expect(isPushApiAvailable()).toBe(false);
  });

  it("returns false without navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isPushApiAvailable()).toBe(false);
  });
});
