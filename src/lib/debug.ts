/**
 * Lightweight debug logger.
 *
 * - In Tauri runtime: appends to `<app_data_dir>/debug.log` via
 *   `@tauri-apps/plugin-fs`. Falls back to `console.warn` on any
 *   permission/disk error so the log path never crashes the host flow.
 * - In Browser (vite dev / plain browser): appends to `localStorage` key
 *   `quant-debug-log` as a ring buffer of the last `MAX_LOG_ENTRIES`
 *   entries.
 *
 * The log is append-only — entries are timestamped. Use `getDebugLog()`
 * to read everything back, `clearDebugLog()` to wipe.
 *
 * Previously gated by `if (!isDev()) return;`. That gate was removed:
 * when `import.meta.env.DEV` is somehow false in dev (or undefined in
 * a misconfigured build) we still want the log — otherwise we silently
 * lose evidence of the very bugs the log is supposed to help diagnose.
 * The cost of always writing is negligible (≤ a few KB per session).
 *
 * NOTE: this module imports `@tauri-apps/plugin-fs` directly rather than
 * going through `@/infra/tauriBridge`. That is intentional: the bridge
 * exposes only project-specific helpers (`readKeystoreBuffer`, etc.) and
 * has no generic "read arbitrary file" wrapper. Adding one would mean a
 * non-trivial refactor of `tauriBridge.ts`, which is explicitly out of
 * scope for this debug tooling. Since `debug.ts` itself is a debug-only
 * utility (no-op in production) the architecture rule of "no direct
 * plugin imports in feature code" is exempted by design.
 */

/// <reference types="vite/client" />

declare const window: { __TAURI_INTERNALS__?: unknown };

import { BaseDirectory, readFile, writeFile } from "@tauri-apps/plugin-fs";

const DEBUG_LOG_FILENAME = "debug.log";
const LOCALSTORAGE_KEY = "quant-debug-log";
const MAX_LOG_ENTRIES = 200;
const MAX_FILE_LINES = 500;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** True when running a dev build. */
export function isDev(): boolean {
  return import.meta.env.DEV === true;
}

/** Pure DOM check for Tauri runtime (avoids importing @tauri-apps/api). */
function inTauri(): boolean {
  try {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  } catch {
    return false;
  }
}

/**
 * Format one log entry as a string. Includes timestamp, label, optional
 * context, and full error introspection (type, constructor, value, stack).
 */
export function formatDebugEntry(
  label: string,
  err: unknown,
  context?: Record<string, unknown>,
): string {
  const ts = new Date().toISOString();
  const errInfo: Record<string, unknown> = {
    type: typeof err,
    constructor:
      (err as { constructor?: { name?: string } })?.constructor?.name ?? "unknown",
    value: safeStringify(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  const ctxStr = context ? `\n  context: ${safeStringify(context)}` : "";
  return `[${ts}] [${label}]${ctxStr}\n  error: ${safeStringify(errInfo)}`;
}

function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 5000 ? s.slice(0, 5000) + "…" : s;
  } catch {
    return String(v);
  }
}

/** Read existing debug.log from app data dir. Empty string if missing/error. */
async function readAppDebugLog(): Promise<string> {
  try {
    const buf = await readFile(DEBUG_LOG_FILENAME, {
      baseDir: BaseDirectory.AppData,
    });
    return decoder.decode(buf);
  } catch {
    return "";
  }
}

/** Write the entire debug.log content to app data dir. */
async function writeAppDebugLog(content: string): Promise<void> {
  await writeFile(
    DEBUG_LOG_FILENAME,
    encoder.encode(content),
    { baseDir: BaseDirectory.AppData },
  );
}

/** Append a debug entry. Always-on; the cost of writing is negligible. */
export async function debugLog(
  label: string,
  err: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  const entry = formatDebugEntry(label, err, context);
  if (inTauri()) {
    try {
      const existing = await readAppDebugLog();
      const merged =
        existing +
        (existing.length > 0 && !existing.endsWith("\n") ? "\n" : "") +
        entry +
        "\n";
      const lines = merged.split("\n");
      const trimmed = lines.slice(-MAX_FILE_LINES).join("\n");
      await writeAppDebugLog(trimmed);
    } catch (writeErr) {
      // Fallback: log to console if file write fails (permissions, disk, etc.)
      console.warn("[debug] failed to write debug.log:", writeErr, "entry:", entry);
    }
  } else {
    try {
      const raw = localStorage.getItem(LOCALSTORAGE_KEY);
      const arr: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      arr.push(entry);
      const trimmed = arr.slice(-MAX_LOG_ENTRIES);
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(trimmed));
    } catch (lsErr) {
      console.warn("[debug] failed to write localStorage:", lsErr);
    }
  }
}

/** Read the entire debug log as a string. */
export async function getDebugLog(): Promise<string> {
  if (inTauri()) {
    return readAppDebugLog();
  }
  try {
    const raw = localStorage.getItem(LOCALSTORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]).join("\n") : "";
  } catch {
    return "";
  }
}

/** Clear the debug log. */
export async function clearDebugLog(): Promise<void> {
  if (inTauri()) {
    try {
      await writeAppDebugLog("");
    } catch {
      // ignore
    }
  } else {
    localStorage.removeItem(LOCALSTORAGE_KEY);
  }
}

/**
 * Where the log lives. For display in UI ("see at: <path>").
 * In browser mode there's no real file path — show localStorage key.
 */
export function getDebugLogLocation(): string {
  if (inTauri()) {
    return `<app_data_dir>/${DEBUG_LOG_FILENAME}`;
  }
  return `browser localStorage["${LOCALSTORAGE_KEY}"]`;
}
