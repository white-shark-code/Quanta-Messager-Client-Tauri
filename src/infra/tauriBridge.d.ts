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
import { type UnlistenFn } from "@tauri-apps/api/event";
import type { AppLifecycleEvent } from "./tauri.types";
/**
 * Read the raw ciphertext blob of `<userId>`'s keystore from
 * `<app_data_dir>/keystores/<userId>.qks`.
 *
 * In the browser, the blob lives in `localStorage["quant-keystore-<userId>"]`.
 * On the Rust side this requires `fs:allow-appdata-read` (or
 * `fs:allow-appdata-read-recursive`) scoped to `$APPDATA/keystores/**`.
 *
 * @throws Rejects if the file does not exist or cannot be read.
 */
export declare function readKeystoreBuffer(userId: string): Promise<Uint8Array>;
/**
 * Atomically write the encrypted keystore blob for `<userId>` to
 * `<app_data_dir>/keystores/<userId>.qks`. In the browser, the same
 * data is base64-encoded into `localStorage["quant-keystore-<userId>"]`.
 *
 * @param userId The owning user's UUID.
 * @param data   The serialized keystore container bytes (the QKS1
 *               header + ChaCha20 ciphertext produced by
 *               `secure-store/format.ts`).
 */
export declare function writeKeystoreBuffer(userId: string, data: Uint8Array): Promise<void>;
/**
 * Remove the per-user encrypted keystore file from disk. No-op if
 * the file does not exist (deleteKeystoreFile is idempotent — useful
 * for "erase all data" flows that don't need to first check
 * existence). The corresponding index entry is the caller's
 * responsibility (see `removeIndexEntry` in store.ts).
 *
 * Uses an absolute path constructed via `appDataDir + join(...)`
 * instead of `BaseDirectory.AppData` because the Tauri v2 fs plugin's
 * scoped permission identifiers (`fs:allow-appdata-remove`) aren't
 * reliably recognised across plugin versions — falling back to an
 * absolute path matches the `fs:allow-remove` (non-scoped) permission
 * which is part of `fs:default` and works reliably everywhere.
 */
export declare function deleteKeystoreFile(userId: string): Promise<void>;
/**
 * Check whether `<userId>`'s keystore file already exists.
 *
 * @returns `true` if the file is present.
 */
export declare function hasKeystore(userId: string): Promise<boolean>;
/**
 * Read the unencrypted `keystores/index.json` file as raw bytes.
 * Returns an empty Uint8Array when the file is missing — callers
 * (see `readIndex` in store.ts) treat that as "no users registered".
 */
export declare function readIndexBuffer(): Promise<Uint8Array>;
/**
 * Write the unencrypted `keystores/index.json` file. Replaces any
 * existing content. The file is plain JSON (no encryption) — only
 * userId + email + lastUsedAt metadata is stored here, no secrets.
 */
export declare function writeIndexBuffer(data: Uint8Array): Promise<void>;
/**
 * Прочитать сырой ChaCha20-Poly1305 блоб диалога
 * `<app_data_dir>/dialogs/<userId>/<chatId>.qdlog`. В браузерном
 * режиме блоб хранится в `localStorage["quant-dialog-<userId>-<chatId>"]`.
 *
 * @throws Отвергает, если файл не существует или не читается.
 */
export declare function readDialogBuffer(userId: string, chatId: string): Promise<Uint8Array>;
/**
 * Атомарно записать ChaCha20-Poly1305 блоб диалога. В браузерном
 * режиме данные base64-кодируются в `localStorage`.
 *
 * @param userId UUID владельца.
 * @param data Сырые байты контейнера QDLG1 (header + ciphertext).
 */
export declare function writeDialogBuffer(userId: string, chatId: string, data: Uint8Array): Promise<void>;
/** Есть ли локальный блоб для данного чата. */
export declare function hasDialog(userId: string, chatId: string): Promise<boolean>;
/**
 * Удалить блоб диалога с диска. No-op, если файла нет (идемпотентно —
 * удобно для сценариев «стереть всё» без предварительной проверки).
 * Соответствующую запись в per-user индексе удаляет caller.
 */
export declare function deleteDialogFile(userId: string, chatId: string): Promise<void>;
/**
 * Прочитать нешифрованный индексный файл `dialogs/<userId>/index.json`
 * со списком `chatId`, для которых есть локальная копия. Возвращает
 * `[]`, если файла нет.
 */
export declare function readDialogIndex(userId: string): Promise<string[]>;
/** Перезаписать индексный файл целиком. */
export declare function writeDialogIndex(userId: string, chatIds: string[]): Promise<void>;
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
export declare function writeFileBuffer(path: string, data: Uint8Array): Promise<void>;
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
export declare function pickFiles(multiple?: boolean): Promise<string[] | null>;
/**
 * Open a native "save as" dialog for an arbitrary export file.
 *
 * Wraps `@tauri-apps/plugin-dialog#save`. On the Rust side this
 * requires `dialog:allow-save`. Callers specify the default file name
 * and, optionally, a set of extension filters shown in the dialog
 * (e.g. `.qks` for the keystore backup, `.asc` / `.txt` for an
 * ASCII-armored PGP key).
 *
 * @param options.defaultPath Default file name suggested in the dialog.
 * @param options.filters Optional file-type filters for the dialog.
 * @returns Selected absolute path, or `null` if the user cancelled.
 */
export declare function pickSaveFile(options: {
    defaultPath: string;
    filters?: {
        name: string;
        extensions: string[];
    }[];
}): Promise<string | null>;
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
export declare function notify(title: string, body: string): Promise<void>;
/**
 * Resolve the notification permission to a `boolean`, requesting it on
 * demand. Useful for UI that wants to show a permission prompt CTA up
 * front (rather than waiting for the first {@link notify} call).
 *
 * @returns `true` iff the OS reports the permission as `granted`.
 */
export declare function ensureNotificationPermission(): Promise<boolean>;
/**
 * Deep-link URL parsed into a typed route. Unrecognized URLs collapse
 * to `"unknown"` so callers can safely ignore them.
 */
export type DeepLinkRoute = {
    kind: "chat";
    id: string;
} | {
    kind: "unknown";
};
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
export declare function onDeepLink(handler: (urls: string[]) => void): Promise<UnlistenFn>;
/**
 * Parse a `quant://` deep-link URL into a typed route.
 *
 * Currently only `quant://chat/{id}` is recognized. Any URL that
 * fails to parse, or whose scheme/host/path does not match a known
 * route, is returned as `{ kind: "unknown" }` so the caller never has
 * to handle exceptions.
 */
export declare function parseDeepLink(url: string): DeepLinkRoute;
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
export declare function onAppEvent(event: AppLifecycleEvent, handler: () => void): Promise<UnlistenFn>;
/**
 * Subscribe to the "lock screen now" request emitted by Rust.
 *
 * The `app://lock` event is emitted by the `lock_screen_now()` custom
 * Rust command (see `docs/design.md` §8.1). Frontend handlers
 * typically wipe in-memory keys and route back to the lock screen.
 */
export declare function onLockScreenRequest(handler: () => void): Promise<UnlistenFn>;
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
export declare function getAppDataDir(): Promise<string>;
