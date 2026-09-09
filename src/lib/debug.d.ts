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
/** True when running a dev build. */
export declare function isDev(): boolean;
/**
 * Format one log entry as a string. Includes timestamp, label, optional
 * context, and full error introspection (type, constructor, value, stack).
 */
export declare function formatDebugEntry(label: string, err: unknown, context?: Record<string, unknown>): string;
/** Append a debug entry. Always-on; the cost of writing is negligible. */
export declare function debugLog(label: string, err: unknown, context?: Record<string, unknown>): Promise<void>;
/** Read the entire debug log as a string. */
export declare function getDebugLog(): Promise<string>;
/** Clear the debug log. */
export declare function clearDebugLog(): Promise<void>;
/**
 * Where the log lives. For display in UI ("see at: <path>").
 * In browser mode there's no real file path — show localStorage key.
 */
export declare function getDebugLogLocation(): string;
