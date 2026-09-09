// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureNotificationPermission,
  getAppDataDir,
  hasKeystore,
  notify,
  onAppEvent,
  onDeepLink,
  onLockScreenRequest,
  parseDeepLink,
  pickFiles,
  pickSaveFile,
  readKeystoreBuffer,
  writeFileBuffer,
  writeKeystoreBuffer,
} from "@/infra/tauriBridge";

/**
 * Node 22 ships an experimental `localStorage` getter on `globalThis`
 * that returns `undefined` unless `--localstorage-file` is passed.
 * Vitest's jsdom env intentionally does NOT override that property
 * (because it's already in the Node global), so the production code
 * under test would see `localStorage === undefined` even though jsdom
 * has a fully working `Storage` proxy on `globalThis.jsdom.window`.
 *
 * Workaround: delete Node's broken getter and re-install jsdom's
 * working Storage proxy as the canonical `localStorage` on
 * `globalThis`. This makes the keystore fallback path (which calls
 * `localStorage.getItem` / `localStorage.setItem`) behave like in a
 * real browser.
 */
function installJsdomLocalStorage(): void {
  const jsdomInstance = (globalThis as Record<string, unknown>).jsdom as
    | { window: { _localStorage: Storage } }
    | undefined;
  const jsdomLs = jsdomInstance?.window?._localStorage;
  if (!jsdomLs) return;
  delete (globalThis as Record<string, unknown>).localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    value: jsdomLs,
    writable: true,
    configurable: true,
  });
}

/**
 * Force the browser-mode fallback path of `tauriBridge.ts`.
 *
 * Both `isTauri()` (in tauriBridge) and `inTauri()` (in lib/debug.ts)
 * check for `__TAURI_INTERNALS__`. To exercise the localStorage fallback
 * we wipe the marker from BOTH `window` and `globalThis`, then clear
 * localStorage so each test starts from a known state.
 */
function forceBrowserMode(): void {
  installJsdomLocalStorage();
  // Remove the Tauri internals marker from `globalThis` (which is
  // where Vitest's jsdom env wires the jsdom `window`, so this
  // covers both `globalThis.__TAURI_INTERNALS__` and `window.__TAURI_INTERNALS__`).
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
  localStorage.clear();
}

beforeEach(() => {
  forceBrowserMode();
});

afterEach(() => {
  forceBrowserMode();
});

describe("tauriBridge — browser fallback (keystore via localStorage)", () => {
  const USER_A = "11111111-aaaa-bbbb-cccc-222222222222";
  const USER_B = "33333333-dddd-eeee-ffff-444444444444";

  it("hasKeystore() returns false for an unknown userId", async () => {
    await expect(hasKeystore(USER_A)).resolves.toBe(false);
  });

  it("writeKeystoreBuffer() then hasKeystore() returns true for the same userId", async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await writeKeystoreBuffer(USER_A, data);
    await expect(hasKeystore(USER_A)).resolves.toBe(true);
    // Other users remain independent.
    await expect(hasKeystore(USER_B)).resolves.toBe(false);
  });

  it("writeKeystoreBuffer() then readKeystoreBuffer() returns identical bytes (round-trip)", async () => {
    const original = new Uint8Array([0, 1, 2, 3, 255, 254, 128, 64, 32, 16]);
    await writeKeystoreBuffer(USER_A, original);
    const back = await readKeystoreBuffer(USER_A);
    expect(back).toBeInstanceOf(Uint8Array);
    expect(Array.from(back)).toEqual(Array.from(original));
  });

  it("readKeystoreBuffer() throws when no keystore exists for the given userId", async () => {
    await expect(readKeystoreBuffer(USER_A)).rejects.toThrow(/Keystore not found/);
  });

  it("two users' keystores do not interfere with each other", async () => {
    const dataA = new Uint8Array([10, 20, 30]);
    const dataB = new Uint8Array([40, 50, 60, 70]);
    await writeKeystoreBuffer(USER_A, dataA);
    await writeKeystoreBuffer(USER_B, dataB);
    expect(Array.from(await readKeystoreBuffer(USER_A))).toEqual([10, 20, 30]);
    expect(Array.from(await readKeystoreBuffer(USER_B))).toEqual([40, 50, 60, 70]);
  });

  it("round-trips a 100k random byte buffer (larger than the base64 chunk size 0x8000)", async () => {
    const SIZE = 100_000;
    const data = new Uint8Array(SIZE);
    // Deterministic pseudo-random fill (no Math.random in tests, but
    // a simple LCG is fine to exercise the chunking logic).
    let seed = 0x1234_5678;
    for (let i = 0; i < SIZE; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fff_ffff;
      // eslint-disable-next-line security/detect-object-injection -- typed-array index write with loop-bounded `i`
      data[i] = seed & 0xff;
    }
    await writeKeystoreBuffer(USER_A, data);
    const back = await readKeystoreBuffer(USER_A);
    expect(back).toBeInstanceOf(Uint8Array);
    expect(back.length).toBe(SIZE);
    expect(Array.from(back)).toEqual(Array.from(data));
  });
});

describe("tauriBridge — browser fallback (functions that throw)", () => {
  it("writeFileBuffer() throws in browser mode", async () => {
    await expect(
      writeFileBuffer("/tmp/x.bin", new Uint8Array([0])),
    ).rejects.toThrow(/browser mode/);
  });

  it("pickFiles() throws in browser mode", async () => {
    await expect(pickFiles()).rejects.toThrow(/browser mode/);
    await expect(pickFiles(true)).rejects.toThrow(/browser mode/);
  });

  it("pickSaveFile() throws in browser mode", async () => {
    await expect(
      pickSaveFile({
        defaultPath: "export.qks",
        filters: [{ name: "Quant Keystore", extensions: ["qks"] }],
      }),
    ).rejects.toThrow(/browser mode/);
  });

  it("getAppDataDir() throws in browser mode (Tauri-only command)", async () => {
    await expect(getAppDataDir()).rejects.toThrow(
      /App data dir only available in Tauri runtime/,
    );
  });
});

describe("tauriBridge — browser fallback (notifications)", () => {
  it("notify() does NOT throw in browser mode (silent no-op)", async () => {
    await expect(notify("title", "body")).resolves.toBeUndefined();
  });

  it("ensureNotificationPermission() returns true in browser mode", async () => {
    await expect(ensureNotificationPermission()).resolves.toBe(true);
  });
});

describe("tauriBridge — parseDeepLink", () => {
  it("returns { kind: 'chat', id } for 'quant://chat/abc-123'", () => {
    expect(parseDeepLink("quant://chat/abc-123")).toEqual({
      kind: "chat",
      id: "abc-123",
    });
  });

  it("returns { kind: 'unknown' } for 'quant://chat/' (empty id)", () => {
    expect(parseDeepLink("quant://chat/")).toEqual({ kind: "unknown" });
  });

  it("returns { kind: 'unknown' } for an http URL (wrong scheme)", () => {
    expect(parseDeepLink("http://example.com/")).toEqual({ kind: "unknown" });
  });

  it("returns { kind: 'unknown' } for a malformed string", () => {
    expect(parseDeepLink("not a url")).toEqual({ kind: "unknown" });
  });

  it("returns { kind: 'unknown' } for an unrecognized 'quant://' host", () => {
    expect(parseDeepLink("quant://unknown")).toEqual({ kind: "unknown" });
    expect(parseDeepLink("quant://settings/foo")).toEqual({ kind: "unknown" });
  });
});

describe("tauriBridge — event subscription helpers (browser mode)", () => {
  it("onDeepLink() returns an unlisten function without throwing", async () => {
    const unlisten = await onDeepLink(() => {
      /* no-op */
    });
    expect(typeof unlisten).toBe("function");
    // Calling the unlisten function should be safe in browser mode.
    expect(() => unlisten()).not.toThrow();
  });

  it("onAppEvent() returns an unlisten function without throwing", async () => {
    const unlisten = await onAppEvent("paused", () => {
      /* no-op */
    });
    expect(typeof unlisten).toBe("function");
    expect(() => unlisten()).not.toThrow();
  });

  it("onLockScreenRequest() returns an unlisten function without throwing", async () => {
    const unlisten = await onLockScreenRequest(() => {
      /* no-op */
    });
    expect(typeof unlisten).toBe("function");
    expect(() => unlisten()).not.toThrow();
  });
});
