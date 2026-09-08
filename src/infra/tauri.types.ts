/**
 * Shared TypeScript types for the Tauri bridge layer.
 *
 * These types describe the contract between the frontend and the
 * Tauri Rust side (custom commands + plugin events). Keeping them in a
 * dedicated module avoids accidental circular dependencies between
 * {@link ./tauriBridge} and the rest of `src/infra`.
 */

/**
 * Discriminated result of a Tauri `invoke` call.
 *
 * Use as a transport-level envelope around Rust commands that can fail
 * in expected, non-throwing ways (e.g. validation, business rules).
 * For raw `invoke` rejections (panic, IO) prefer letting the rejection
 * propagate; this envelope is for *successfully invoked* commands that
 * choose to return an error variant.
 *
 * @example
 * ```ts
 * const res = await invoke<MyPayload>("some_command", { input });
 * if (res.ok) {
 *   use(res.data);
 * } else {
 *   showError(res.error);
 * }
 * ```
 */
export type TauriResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * High-level application lifecycle transitions.
 *
 * Mapped to the following Rust-emitted event names (see
 * `docs/design.md` §8.3 and the JSDoc in {@link ./tauriBridge}):
 * - `"paused"`  → `app://paused`
 * - `"resumed"` → `app://resumed`
 * - `"focus"`   → `app://focus`
 * - `"blur"`    → `app://blur`
 *
 * On Android these are forwarded from the main activity's
 * `onPause` / `onResume` callbacks; on desktop they originate from
 * window focus/blur. The Rust side is responsible for emitting the
 * matching `app://*` events.
 */
export type AppLifecycleEvent = "paused" | "resumed" | "focus" | "blur";
