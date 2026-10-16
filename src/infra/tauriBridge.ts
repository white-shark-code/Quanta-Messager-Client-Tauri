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
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { BaseDirectory, exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";

import type { AppLifecycleEvent } from "./tauri.types";
import { appDataDir, join } from "@tauri-apps/api/path";

/**
 * Detect whether we're running inside the Tauri runtime (desktop/mobile).
 *
 * Tauri v2 exposes `window.__TAURI_INTERNALS__` as the canonical marker.
 * In plain browser dev mode (vite at localhost:1420) this object is absent,
 * so all Tauri-dependent code paths must fall back to safe browser equivalents.
 *
 * NOTE: do NOT import from `@tauri-apps/api/core` here — the dynamic import
 * resolution itself can throw when the polyfill isn't loaded. Pure DOM
 * check is more robust.
 */
function isTauri(): boolean {
  try {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * File operations (encrypted keystore) — multi-user
 * ------------------------------------------------------------------ */

const KEYSTORE_DIR = "keystores";
const INDEX_FILENAME = `${KEYSTORE_DIR}/index.json`;

function userKeyFilename(userId: string): string {
  // Defensive: refuse path-traversal in userId (it's a UUID from the
  // server, so this should never happen, but a stray "../" would
  // otherwise be able to escape the keystores directory).
  if (
    userId.length === 0 ||
    userId.includes("/") ||
    userId.includes("\\") ||
    userId.includes("..")
  ) {
    throw new Error(`Invalid userId for keystore path: ${userId}`);
  }
  return `${KEYSTORE_DIR}/${userId}.qks`;
}

/**
 * Ensure `<app_data_dir>/keystores/` exists. Tauri plugin-fs's
 * `writeFile` does NOT auto-create parent directories, so the very
 * first write (of either a per-user keystore or the index) on a clean
 * device would otherwise fail with "No such file or directory".
 *
 * Idempotent — `mkdir(..., { recursive: true })` is a no-op if the
 * directory already exists. Any failure (e.g. permission denied) is
 * swallowed here so the subsequent writeFile surfaces a clearer error.
 */
async function ensureKeystoresDir(): Promise<void> {
  if (!isTauri()) return; // localStorage fallback needs no directories
  try {
    const base = await appDataDir();
    const dir = await join(base, KEYSTORE_DIR);
    await mkdir(dir, { recursive: true });
  } catch {
    // Either already exists (no-op), or writeFile will fail with a
    // clearer message than "mkdir failed" later on.
  }
}

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
export async function readKeystoreBuffer(userId: string): Promise<Uint8Array> {
  if (!isTauri()) {
    const b64 = localStorage.getItem(`quant-keystore-${userId}`);
    if (b64 === null) {
      throw new Error(`Keystore not found for user ${userId}`);
    }
    return base64ToBytes(b64);
  }
  return readFile(userKeyFilename(userId), { baseDir: BaseDirectory.AppData });
}

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
export async function writeKeystoreBuffer(userId: string, data: Uint8Array): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(`quant-keystore-${userId}`, bytesToBase64(data));
    return;
  }
  await ensureKeystoresDir();
  await writeFile(userKeyFilename(userId), data, { baseDir: BaseDirectory.AppData });
}

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
export async function deleteKeystoreFile(userId: string): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(`quant-keystore-${userId}`);
    return;
  }
  try {
    const { remove } = await import("@tauri-apps/plugin-fs");
    const base = await appDataDir();
    const absolutePath = await join(base, userKeyFilename(userId));
    await remove(absolutePath);
  } catch {
    // File doesn't exist or `remove` not available — treat as success.
  }
}

/**
 * Check whether `<userId>`'s keystore file already exists.
 *
 * @returns `true` if the file is present.
 */
export async function hasKeystore(userId: string): Promise<boolean> {
  if (!isTauri()) {
    return localStorage.getItem(`quant-keystore-${userId}`) !== null;
  }
  return exists(userKeyFilename(userId), { baseDir: BaseDirectory.AppData });
}

/* ------------------------------------------------------------------ *
 * Index file (unencrypted metadata)
 * ------------------------------------------------------------------ */

/**
 * Read the unencrypted `keystores/index.json` file as raw bytes.
 * Returns an empty Uint8Array when the file is missing — callers
 * (see `readIndex` in store.ts) treat that as "no users registered".
 */
export async function readIndexBuffer(): Promise<Uint8Array> {
  if (!isTauri()) {
    const v = localStorage.getItem("quant-keystore-index");
    if (v === null) return new Uint8Array(0);
    return base64ToBytes(v);
  }
  try {
    return await readFile(INDEX_FILENAME, { baseDir: BaseDirectory.AppData });
  } catch {
    return new Uint8Array(0);
  }
}

/**
 * Write the unencrypted `keystores/index.json` file. Replaces any
 * existing content. The file is plain JSON (no encryption) — only
 * userId + email + lastUsedAt metadata is stored here, no secrets.
 */
export async function writeIndexBuffer(data: Uint8Array): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem("quant-keystore-index", bytesToBase64(data));
    return;
  }
  await ensureKeystoresDir();
  await writeFile(INDEX_FILENAME, data, { baseDir: BaseDirectory.AppData });
}

/* ------------------------------------------------------------------ *
 * Файловые операции (шифрованный диалог-стор) — per-user, per-chat
 * ------------------------------------------------------------------ */

const DIALOG_DIR = "dialogs";

function safeSegment(s: string): string {
  if (s.length === 0 || s.includes("/") || s.includes("\\") || s.includes("..")) {
    throw new Error(`Invalid segment for dialog path: ${s}`);
  }
  return s;
}

function dialogFilename(userId: string, chatId: string): string {
  return `${DIALOG_DIR}/${safeSegment(userId)}/${safeSegment(chatId)}.qdlog`;
}

function dialogIndexFilename(userId: string): string {
  return `${DIALOG_DIR}/${safeSegment(userId)}/index.json`;
}

async function ensureDialogsDir(userId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const base = await appDataDir();
    const dir = await join(base, DIALOG_DIR, safeSegment(userId));
    await mkdir(dir, { recursive: true });
  } catch {
    // best-effort; writeFile will surface a clearer error on failure
  }
}

/**
 * Прочитать сырой ChaCha20-Poly1305 блоб диалога
 * `<app_data_dir>/dialogs/<userId>/<chatId>.qdlog`. В браузерном
 * режиме блоб хранится в `localStorage["quant-dialog-<userId>-<chatId>"]`.
 *
 * @throws Отвергает, если файл не существует или не читается.
 */
export async function readDialogBuffer(userId: string, chatId: string): Promise<Uint8Array> {
  if (!isTauri()) {
    const b64 = localStorage.getItem(`quant-dialog-${userId}-${chatId}`);
    if (b64 === null) {
      throw new Error(`Dialog not found for ${userId}/${chatId}`);
    }
    return base64ToBytes(b64);
  }
  return readFile(dialogFilename(userId, chatId), { baseDir: BaseDirectory.AppData });
}

/**
 * Атомарно записать ChaCha20-Poly1305 блоб диалога. В браузерном
 * режиме данные base64-кодируются в `localStorage`.
 *
 * @param userId UUID владельца.
 * @param data Сырые байты контейнера QDLG1 (header + ciphertext).
 */
export async function writeDialogBuffer(
  userId: string,
  chatId: string,
  data: Uint8Array,
): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(`quant-dialog-${userId}-${chatId}`, bytesToBase64(data));
    return;
  }
  await ensureDialogsDir(userId);
  await writeFile(dialogFilename(userId, chatId), data, { baseDir: BaseDirectory.AppData });
}

/** Есть ли локальный блоб для данного чата. */
export async function hasDialog(userId: string, chatId: string): Promise<boolean> {
  if (!isTauri()) {
    return localStorage.getItem(`quant-dialog-${userId}-${chatId}`) !== null;
  }
  return exists(dialogFilename(userId, chatId), { baseDir: BaseDirectory.AppData });
}

/**
 * Удалить блоб диалога с диска. No-op, если файла нет (идемпотентно —
 * удобно для сценариев «стереть всё» без предварительной проверки).
 * Соответствующую запись в per-user индексе удаляет caller.
 */
export async function deleteDialogFile(userId: string, chatId: string): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(`quant-dialog-${userId}-${chatId}`);
    return;
  }
  try {
    const { remove } = await import("@tauri-apps/plugin-fs");
    const base = await appDataDir();
    const absolutePath = await join(base, dialogFilename(userId, chatId));
    await remove(absolutePath);
  } catch {
    // файла нет — окей
  }
}

/**
 * Прочитать нешифрованный индексный файл `dialogs/<userId>/index.json`
 * со списком `chatId`, для которых есть локальная копия. Возвращает
 * `[]`, если файла нет.
 */
export async function readDialogIndex(userId: string): Promise<string[]> {
  if (!isTauri()) {
    const raw = localStorage.getItem(`quant-dialog-index-${userId}`);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
    } catch {
      return [];
    }
  }
  try {
    const buf = await readFile(dialogIndexFilename(userId), { baseDir: BaseDirectory.AppData });
    const text = new TextDecoder().decode(buf);
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Перезаписать индексный файл целиком. */
export async function writeDialogIndex(userId: string, chatIds: string[]): Promise<void> {
  const json = JSON.stringify(chatIds);
  if (!isTauri()) {
    localStorage.setItem(`quant-dialog-index-${userId}`, json);
    return;
  }
  await ensureDialogsDir(userId);
  await writeFile(dialogIndexFilename(userId), new TextEncoder().encode(json), {
    baseDir: BaseDirectory.AppData,
  });
}

/* ------------------------------------------------------------------ *
 * Media vault buffers (decrypted media at rest, ChaCha envelope)
 * ------------------------------------------------------------------ */

const MEDIA_DIR = "media";

function mediaFilename(userId: string, mediaId: string): string {
  return `${MEDIA_DIR}/${safeSegment(userId)}/${safeSegment(mediaId)}.qmed`;
}

function mediaIndexFilename(userId: string): string {
  return `${MEDIA_DIR}/${safeSegment(userId)}/index.json`;
}

async function ensureMediaDir(userId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const base = await appDataDir();
    const dir = await join(base, MEDIA_DIR, safeSegment(userId));
    await mkdir(dir, { recursive: true });
  } catch {
    // best-effort; writeFile will surface a clearer error on failure
  }
}

/**
 * Read a raw media-vault blob `<app_data_dir>/media/<userId>/<mediaId>.qmed`.
 * Browser fallback: `localStorage["quant-media-<userId>-<mediaId>"]`
 * (note the ~5 MB quota — large attachments only persist under Tauri).
 *
 * @throws When the entry does not exist or is unreadable (caller treats
 *   as a vault miss and falls back to network).
 */
export async function readMediaBuffer(userId: string, mediaId: string): Promise<Uint8Array> {
  if (!isTauri()) {
    const b64 = localStorage.getItem(`quant-media-${userId}-${mediaId}`);
    if (b64 === null) {
      throw new Error(`Media not found for ${userId}/${mediaId}`);
    }
    return base64ToBytes(b64);
  }
  return readFile(mediaFilename(userId, mediaId), { baseDir: BaseDirectory.AppData });
}

/**
 * Atomically write a media-vault blob. Browser fallback base64-encodes
 * into `localStorage` (may throw `QuotaExceededError` for large files —
 * callers persist best-effort and ignore such failures).
 */
export async function writeMediaBuffer(
  userId: string,
  mediaId: string,
  data: Uint8Array,
): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(`quant-media-${userId}-${mediaId}`, bytesToBase64(data));
    return;
  }
  await ensureMediaDir(userId);
  await writeFile(mediaFilename(userId, mediaId), data, { baseDir: BaseDirectory.AppData });
}

/** Whether a vault entry exists for the media id. */
export async function hasMedia(userId: string, mediaId: string): Promise<boolean> {
  if (!isTauri()) {
    return localStorage.getItem(`quant-media-${userId}-${mediaId}`) !== null;
  }
  return exists(mediaFilename(userId, mediaId), { baseDir: BaseDirectory.AppData });
}

/**
 * Delete a vault entry. Idempotent no-op when missing.
 */
export async function deleteMediaFile(userId: string, mediaId: string): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(`quant-media-${userId}-${mediaId}`);
    return;
  }
  try {
    const { remove } = await import("@tauri-apps/plugin-fs");
    const base = await appDataDir();
    const absolutePath = await join(base, mediaFilename(userId, mediaId));
    await remove(absolutePath);
  } catch {
    // missing — fine
  }
}

/**
 * Read the unencrypted media index `media/<userId>/index.json`.
 * Returns `[]` when absent or unparsable.
 */
export async function readMediaIndex(userId: string): Promise<string> {
  if (!isTauri()) {
    return localStorage.getItem(`quant-media-index-${userId}`) ?? "";
  }
  try {
    const buf = await readFile(mediaIndexFilename(userId), { baseDir: BaseDirectory.AppData });
    return new TextDecoder().decode(buf);
  } catch {
    return "";
  }
}

/** Overwrite the media index file wholesale. */
export async function writeMediaIndex(userId: string, json: string): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(`quant-media-index-${userId}`, json);
    return;
  }
  await ensureMediaDir(userId);
  await writeFile(mediaIndexFilename(userId), new TextEncoder().encode(json), {
    baseDir: BaseDirectory.AppData,
  });
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
  if (!isTauri()) {
    throw new Error(
      "File picker not available in browser mode — use Tauri runtime for desktop features",
    );
  }
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
  if (!isTauri()) {
    throw new Error(
      "File picker not available in browser mode — use Tauri runtime for desktop features",
    );
  }
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
export async function pickSaveFile(options: {
  defaultPath: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  if (!isTauri()) {
    throw new Error(
      "File picker not available in browser mode — use Tauri runtime for desktop features",
    );
  }
  return saveDialog({
    defaultPath: options.defaultPath,
    ...(options.filters !== undefined ? { filters: options.filters } : {}),
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
  if (!isTauri()) {
    return;
  }
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
  if (!isTauri()) {
    // Plain browser (vite dev): drive the Web Notification API directly.
    // Returning `true` unconditionally here used to skip the browser
    // prompt entirely, so the push toggle reported "denied" without the
    // user ever seeing a permission request.
    try {
      if (typeof Notification === "undefined") {
        return false;
      }
      if (Notification.permission === "granted") {
        return true;
      }
      if (Notification.permission === "denied") {
        return false;
      }
      return (await Notification.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
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
export type DeepLinkRoute = { kind: "chat"; id: string } | { kind: "unknown" };

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
export async function onDeepLink(handler: (urls: string[]) => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {
      // No-op outside Tauri runtime — no listener to detach.
    };
  }
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
  if (!isTauri()) {
    return () => {
      // No-op outside Tauri runtime — no listener to detach.
    };
  }
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
export async function onLockScreenRequest(handler: () => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {
      // No-op outside Tauri runtime — no listener to detach.
    };
  }
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
  if (!isTauri()) {
    throw new Error("App data dir only available in Tauri runtime");
  }
  return invoke<string>("get_app_data_dir");
}
