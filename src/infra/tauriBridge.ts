/**
 * Typed wrappers around Tauri v2 plugin APIs and custom Rust commands.
 *
 * Every Tauri interaction from feature code must go through this module.
 * Callers therefore never import `@tauri-apps/plugin-*` directly — that
 * rule is what lets `TASK-014` / `TASK-005` guarantee that there are "no
 * direct `invoke()` calls in features" (see `.agents/tasks.md`).
 *
 * ## Rust-side contract expected by this module
 *
 * The following Rust pieces must be implemented alongside this file
 * (they are documented in `docs/design.md` §8.1 and tracked separately
 * in the Rust task list — not part of TASK-014):
 *
 * 1. Custom command `get_app_data_dir() -> String`, registered via
 *    `tauri::generate_handler!` in `src-tauri/src/lib.rs`. It should
 *    wrap `path::app_data_dir()` and `to_string_lossy()`, with the
 *    Android-specific fallback to `getFilesDir()`.
 * 2. Event `app://paused`, `app://resumed`, `app://focus`, `app://blur`
 *    emitted from the main activity (`onPause`/`onResume`) and from
 *    window focus/blur handlers. Frontend listeners are wired through
 *    {@link onAppEvent}.
 * 3. Event `app://lock` emitted by the `lock_screen_now()` custom
 *    command. Frontend listeners are wired through
 *    {@link onLockScreenRequest}.
 *
 * Plugin permissions required in `src-tauri/capabilities/default.json`:
 * - `dialog:allow-open`, `dialog:allow-save`
 * - `fs:allow-read-file`, `fs:allow-write-file`, `fs:allow-exists`
 *   (scoped to `$APPDATA/**`)
 * - `notification:default`
 * - `deep-link:default`
 */

import { invoke } from "@tauri-apps/api/core";
import {
  type UnlistenFn,
  listen,
} from "@tauri-apps/api/event";
import {
  BaseDirectory,
  exists,
  readFile,
  writeFile,
} from "@tauri-apps/plugin-fs";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";

import type { AppLifecycleEvent } from "./tauri.types";

/**
 * Filename of the encrypted keystore inside the platform-specific
 * application-data directory. Kept in sync with `secure-store/store.ts`.
 */
const KEYSTORE_FILENAME = "keystore.qks";

/* ------------------------------------------------------------------ *
 * File operations (encrypted keystore)
 * ------------------------------------------------------------------ */

/**
 * Read the raw ciphertext blob of the keystore from
 * `<app_data_dir>/keystore.qks`.
 *
 * Wraps `@tauri-apps/plugin-fs#readFile` with `BaseDirectory.AppData`.
 * On the Rust side this requires `fs:allow-read-file` scoped to
 * `$APPDATA/**`. The returned buffer is the binary container
 * understood by `secure-store/format.ts` (magic header + ChaCha20
 * ciphertext + nonce).
 *
 * @throws Rejects if the file does not exist or cannot be read.
 */
export async function readKeystoreBuffer(): Promise<Uint8Array> {
  return readFile(KEYSTORE_FILENAME, { baseDir: BaseDirectory.AppData });
}

/**
 * Atomically write the encrypted keystore blob to
 * `<app_data_dir>/keystore.qks`.
 *
 * Wraps `@tauri-apps/plugin-fs#writeFile`. On the Rust side this
 * requires `fs:allow-write-file` scoped to `$APPDATA/**`. The default
 * `create: true` option from the plugin is preserved: if the file does
 * not exist it is created, otherwise it is overwritten.
 *
 * @param data The serialized keystore container bytes.
 */
export async function writeKeystoreBuffer(data: Uint8Array): Promise<void> {
  await writeFile(KEYSTORE_FILENAME, data, { baseDir: BaseDirectory.AppData });
}

/**
 * Check whether a keystore file already exists in the app-data
 * directory. Used to decide whether to show the onboarding flow vs the
 * unlock screen.
 *
 * @returns `true` if `<app_data_dir>/keystore.qks` exists.
 */
export async function hasKeystore(): Promise<boolean> {
  return exists(KEYSTORE_FILENAME, { baseDir: BaseDirectory.AppData });
}

/* ------------------------------------------------------------------ *
 * Dialog wrappers
 * ------------------------------------------------------------------ */

/**
 * Write an arbitrary byte buffer to an absolute path.
 *
 * Wraps `@tauri-apps/plugin-fs#writeFile` with no `baseDir` constraint:
 * the caller passes an absolute filesystem path (typically obtained via
 * {@link pickSaveFile}). On the Rust side this requires
 * `fs:allow-write-file` scoped to whatever paths the dialog returned
 * (the OS itself grants per-write consent via the save dialog).
 *
 * Used by the keystore export flow in `features/keyring/generate.ts`.
 */
export async function writeFileBuffer(path: string, data: Uint8Array): Promise<void> {
  await writeFile(path, data);
}

/**
 * Open a native file-selection dialog.
 *
 * Wraps `@tauri-apps/plugin-dialog#open`. On the Rust side this
 * requires `dialog:allow-open`. The result is normalized to an array
 * for ergonomic iteration at call sites; a single-file selection is
 * returned as a one-element array.
 *
 * @param multiple When `true`, the dialog allows selecting several
 *   files. When `false`, the dialog still returns an array (length 0
 *   on cancellation, length 1 on selection) for a uniform call site.
 * @returns `null` if the user cancelled, otherwise a non-empty array
 *   of absolute file paths.
 */
export async function pickFiles(multiple = false): Promise<string[] | null> {
  const result = await openDialog({
    multiple,
    filters: [{ name: "All", extensions: ["*"] }],
  });
  if (result === null) {
    return null;
  }
  if (Array.isArray(result)) {
    return result;
  }
  return [result];
}

/**
 * Open a native "save as" dialog for a keystore backup.
 *
 * Wraps `@tauri-apps/plugin-dialog#save`. On the Rust side this
 * requires `dialog:allow-save`. Only the `.qks` extension is offered.
 *
 * @param defaultName Default file name suggested in the dialog.
 * @returns Selected absolute path, or `null` if the user cancelled.
 */
export async function pickSaveFile(
  defaultName: string,
): Promise<string | null> {
  return saveDialog({
    defaultPath: defaultName,
    filters: [{ name: "Keystore", extensions: ["qks"] }],
  });
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

/**
 * Show a desktop/mobile notification.
 *
 * Automatically requests permission if it has not been granted yet.
 * On Android the channel identifier is not configurable here — apps
 * that need a custom channel should call the underlying plugin
 * directly (this wrapper is intentionally opinionated for the
 * "incoming message" use case).
 *
 * Silently no-ops if the user denies notification permission (to keep
 * the call sites non-throwing in normal product flows).
 *
 * @param title Notification title.
 * @param body Notification body text.
 */
export async function notify(title: string, body: string): Promise<void> {
  if (!(await ensureNotificationPermission())) {
    return;
  }
  sendNotification({ title, body });
}

/**
 * Resolve the notification permission to a `boolean`, requesting it on
 * demand. Useful for UI that wants to show a permission prompt CTA up
 * front (rather than waiting for the first {@link notify} call).
 *
 * @returns `true` iff the OS reports the permission as `granted`.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) {
    return true;
  }
  return (await requestPermission()) === "granted";
}

/* ------------------------------------------------------------------ *
 * Deep-link
 * ------------------------------------------------------------------ */

/**
 * Deep-link URL parsed into a typed route. Unrecognized URLs collapse
 * to `"unknown"` so callers can safely ignore them.
 */
export type DeepLinkRoute =
  | { kind: "chat"; id: string }
  | { kind: "unknown" };

/**
 * Subscribe to incoming deep-link URLs (`quant://...`).
 *
 * Wraps `@tauri-apps/plugin-deep-link#onOpenUrl`. On the Rust side this
 * requires `deep-link:default`. The returned promise resolves to a
 * function that, when invoked, detaches the listener — callers should
 * call it on cleanup.
 *
 * @param handler Called with the list of URLs the OS handed to the
 *   app on a cold start or runtime activation.
 */
export async function onDeepLink(
  handler: (urls: string[]) => void,
): Promise<UnlistenFn> {
  return onOpenUrl((urls) => {
    handler(urls);
  });
}

/**
 * Parse a `quant://` deep-link URL into a typed route.
 *
 * Currently only `quant://chat/{id}` is recognized. Any URL that
 * fails to parse, or whose scheme/host/path does not match a known
 * route, is returned as `{ kind: "unknown" }` so the caller never has
 * to handle exceptions.
 */
export function parseDeepLink(url: string): DeepLinkRoute {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "unknown" };
  }
  if (parsed.protocol !== "quant:") {
    return { kind: "unknown" };
  }
  if (parsed.host === "chat") {
    const id = parsed.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
    if (id.length === 0) {
      return { kind: "unknown" };
    }
    return { kind: "chat", id };
  }
  return { kind: "unknown" };
}

/* ------------------------------------------------------------------ *
 * Application lifecycle & lock screen
 * ------------------------------------------------------------------ */

/**
 * Event-name mapping for {@link onAppEvent}. The Rust side MUST emit
 * exactly these strings — they are the public contract between the
 * frontend and the lifecycle bridge. See `docs/design.md` §8.3.
 */
function appEventName(event: AppLifecycleEvent): string {
  return `app://${event}`;
}

/**
 * Subscribe to a high-level application lifecycle event.
 *
 * The Rust side is responsible for emitting the matching `app://*`
 * events from the main activity callbacks (`onPause`, `onResume`) and
 * the desktop window focus/blur observers. See
 * `docs/design.md` §8.3.
 *
 * Currently recognized names:
 * - `app://paused`
 * - `app://resumed`
 * - `app://focus`
 * - `app://blur`
 *
 * @param event Which lifecycle event to listen for.
 * @param handler Zero-arg callback fired each time the event arrives.
 *   The event payload is intentionally discarded — if you need richer
 *   data, listen to the raw event name via `listen()` directly.
 */
export async function onAppEvent(
  event: AppLifecycleEvent,
  handler: () => void,
): Promise<UnlistenFn> {
  return listen(appEventName(event), () => {
    handler();
  });
}

/**
 * Subscribe to the "lock screen now" request emitted by Rust.
 *
 * The `app://lock` event is emitted by the `lock_screen_now()` custom
 * Rust command (see `docs/design.md` §8.1). Frontend handlers
 * typically wipe in-memory keys and route back to the lock screen.
 */
export async function onLockScreenRequest(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen("app://lock", () => {
    handler();
  });
}

/* ------------------------------------------------------------------ *
 * App data directory (custom command)
 * ------------------------------------------------------------------ */

/**
 * Resolve the platform-specific application-data directory as an
 * absolute filesystem path.
 *
 * Implemented via the custom Rust command `get_app_data_dir`
 * (described in `docs/design.md` §8.1). That command MUST be
 * registered with `tauri::generate_handler!` in `src-tauri/src/lib.rs`
 * — until it is added, this function rejects with a Tauri "command
 * not found" error.
 *
 * The returned path is suitable for joining with `path.join()` when
 * the frontend needs to construct paths outside of plugin APIs (e.g.
 * for `tauri-plugin-stronghold` snapshots).
 */
export async function getAppDataDir(): Promise<string> {
  return invoke<string>("get_app_data_dir");
}
