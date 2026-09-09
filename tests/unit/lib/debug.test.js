// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, } from "vitest";
// Mock @tauri-apps/plugin-fs so the Tauri-path tests can observe
// readFile/writeFile calls without actually touching the filesystem.
// The browser-path tests don't depend on this mock at all (the browser
// branch of `debugLog` never imports from the Tauri side), but having
// the mock installed doesn't hurt them either.
vi.mock("@tauri-apps/plugin-fs", () => ({
    BaseDirectory: { AppData: 1 },
    readFile: vi.fn(() => Promise.resolve(new Uint8Array())),
    writeFile: vi.fn(() => Promise.resolve(undefined)),
}));
import * as fsPlugin from "@tauri-apps/plugin-fs";
import { clearDebugLog, debugLog, formatDebugEntry, getDebugLog, getDebugLogLocation, isDev, } from "@/lib/debug";
const LS_KEY = "quant-debug-log";
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
 * `globalThis`.
 */
function installJsdomLocalStorage() {
    const jsdomInstance = globalThis.jsdom;
    const jsdomLs = jsdomInstance?.window?._localStorage;
    if (!jsdomLs)
        return;
    delete globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
        value: jsdomLs,
        writable: true,
        configurable: true,
    });
}
/**
 * Strip the marker the debug-logger uses to detect Tauri from BOTH
 * `globalThis` (where `inTauri()` looks) and `window` (where the
 * `tauriBridge.isTauri()` looks — not imported here, but kept
 * symmetric for safety when other test files run in the same jsdom
 * instance).
 */
function forceBrowserMode() {
    installJsdomLocalStorage();
    delete globalThis.__TAURI_INTERNALS__;
    localStorage.clear();
    vi.mocked(fsPlugin.readFile).mockClear();
    vi.mocked(fsPlugin.writeFile).mockClear();
    // Default mocks: readFile returns empty (no existing log);
    // writeFile resolves without error.
    vi.mocked(fsPlugin.readFile).mockResolvedValue(new Uint8Array());
    vi.mocked(fsPlugin.writeFile).mockResolvedValue(undefined);
}
function forceTauriMode() {
    installJsdomLocalStorage();
    globalThis.__TAURI_INTERNALS__ = {};
    localStorage.clear();
    vi.mocked(fsPlugin.readFile).mockClear();
    vi.mocked(fsPlugin.writeFile).mockClear();
    vi.mocked(fsPlugin.readFile).mockResolvedValue(new Uint8Array());
    vi.mocked(fsPlugin.writeFile).mockResolvedValue(undefined);
}
describe("lib/debug — isDev()", () => {
    it("returns true under the default Vitest environment (dev/test mode)", () => {
        expect(isDev()).toBe(true);
    });
    it("returns false when DEV is stubbed to false", () => {
        vi.stubEnv("DEV", false);
        try {
            expect(isDev()).toBe(false);
        }
        finally {
            vi.unstubAllEnvs();
        }
    });
});
describe("lib/debug — debugLog (browser fallback)", () => {
    beforeEach(forceBrowserMode);
    afterEach(forceBrowserMode);
    it("appends an entry to localStorage['quant-debug-log'] containing the label and the error message", async () => {
        const err = new Error("boom");
        await debugLog("my-label", err);
        const raw = localStorage.getItem(LS_KEY);
        expect(raw).not.toBeNull();
        const arr = JSON.parse(raw);
        expect(Array.isArray(arr)).toBe(true);
        expect(arr).toHaveLength(1);
        expect(arr[0]).toContain("my-label");
        expect(arr[0]).toContain("boom");
    });
    it("appends a second entry rather than overwriting the first", async () => {
        await debugLog("first", new Error("one"));
        await debugLog("second", new Error("two"));
        const arr = JSON.parse(localStorage.getItem(LS_KEY));
        expect(arr).toHaveLength(2);
        expect(arr[0]).toContain("first");
        expect(arr[1]).toContain("second");
    });
    it("includes a stack trace for Error inputs", async () => {
        const err = new Error("with-stack");
        await debugLog("stack-check", err);
        const arr = JSON.parse(localStorage.getItem(LS_KEY));
        expect(arr[0]).toMatch(/stack/);
        expect(arr[0]).toContain("with-stack");
    });
    it("does NOT call plugin-fs writeFile in browser mode", async () => {
        await debugLog("browser-path", new Error("nope"));
        expect(fsPlugin.writeFile).not.toHaveBeenCalled();
        expect(fsPlugin.readFile).not.toHaveBeenCalled();
    });
});
describe("lib/debug — debugLog (Tauri path)", () => {
    beforeEach(forceTauriMode);
    afterEach(forceBrowserMode);
    it("calls plugin-fs.writeFile with the formatted entry when in Tauri mode", async () => {
        await debugLog("tauri-label", new Error("tauri-boom"));
        expect(fsPlugin.writeFile).toHaveBeenCalledTimes(1);
        // Second positional arg is the encoded bytes (Uint8Array).
        const call = vi.mocked(fsPlugin.writeFile).mock.calls[0];
        expect(call).toBeDefined();
        // The plugin-fs v2 type union widens `bytes` to
        // `Uint8Array<ArrayBufferLike> | ReadableStream<...>` — narrow it
        // here with a runtime guard since debugLog only ever writes a
        // Uint8Array.
        const bytes = call?.[1];
        expect(bytes).toBeDefined();
        expect(typeof bytes?.length).toBe("number");
        expect(typeof bytes?.[0]).toBe("number");
        const decoded = new TextDecoder().decode(bytes);
        expect(decoded).toContain("tauri-label");
        expect(decoded).toContain("tauri-boom");
    });
    it("does NOT write to localStorage in Tauri mode", async () => {
        await debugLog("tauri-only", new Error("x"));
        expect(localStorage.getItem(LS_KEY)).toBeNull();
    });
});
describe("lib/debug — debugLog (no DEV gate)", () => {
    // debugLog used to short-circuit in production (`!isDev()`). That gate
    // was removed: when `import.meta.env.DEV` is somehow false in dev (or
    // undefined in a misconfigured build) we still want the log.
    beforeEach(forceBrowserMode);
    afterEach(() => {
        vi.unstubAllEnvs();
        forceBrowserMode();
    });
    it("writes even when DEV is false (no DEV gate)", async () => {
        vi.stubEnv("DEV", false);
        await debugLog("prod", new Error("ignored"));
        // Browser path: localStorage gets the entry.
        const raw = localStorage.getItem(LS_KEY);
        expect(raw).not.toBeNull();
        const arr = JSON.parse(raw);
        expect(arr.some((e) => e.includes("[prod]"))).toBe(true);
    });
});
describe("lib/debug — formatDebugEntry", () => {
    it("includes timestamp, label, and error message in the formatted entry", () => {
        const entry = formatDebugEntry("hello", new Error("world"));
        expect(entry).toContain("[hello]");
        expect(entry).toContain("world");
        // ISO 8601 timestamp prefix: [YYYY-MM-DDTHH:MM:SS.sssZ]
        expect(entry).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });
    it("includes serialized context when provided", () => {
        const entry = formatDebugEntry("ctx", new Error("e"), { userId: 42 });
        expect(entry).toContain("userId");
        expect(entry).toContain("42");
    });
    it("handles non-Error values without throwing", () => {
        expect(() => formatDebugEntry("non-err", "just a string")).not.toThrow();
        expect(() => formatDebugEntry("non-err", { foo: "bar" })).not.toThrow();
        expect(() => formatDebugEntry("non-err", null)).not.toThrow();
        expect(() => formatDebugEntry("non-err", undefined)).not.toThrow();
    });
});
describe("lib/debug — getDebugLog / clearDebugLog", () => {
    beforeEach(forceBrowserMode);
    afterEach(forceBrowserMode);
    it("getDebugLog() joins entries from localStorage with newlines", async () => {
        await debugLog("a", new Error("1"));
        await debugLog("b", new Error("2"));
        const log = await getDebugLog();
        expect(log).toContain("a");
        expect(log).toContain("b");
        expect(log).toContain("1");
        expect(log).toContain("2");
    });
    it("getDebugLog() returns '' when no entries are stored", async () => {
        await expect(getDebugLog()).resolves.toBe("");
    });
    it("clearDebugLog() wipes the localStorage ring buffer", async () => {
        await debugLog("to-clear", new Error("x"));
        expect(localStorage.getItem(LS_KEY)).not.toBeNull();
        await clearDebugLog();
        expect(localStorage.getItem(LS_KEY)).toBeNull();
        await expect(getDebugLog()).resolves.toBe("");
    });
});
describe("lib/debug — getDebugLogLocation", () => {
    it("returns the localStorage key path in browser mode", () => {
        forceBrowserMode();
        expect(getDebugLogLocation()).toContain(LS_KEY);
        expect(getDebugLogLocation()).toContain("localStorage");
    });
    it("returns the app-data-dir file path in Tauri mode", () => {
        forceTauriMode();
        expect(getDebugLogLocation()).toContain("debug.log");
        expect(getDebugLogLocation()).toContain("app_data_dir");
        forceBrowserMode();
    });
});
