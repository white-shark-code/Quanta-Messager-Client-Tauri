import { debugLog } from "@/lib/debug";

/**
 * Inbound frames of the realtime events channel (`/event/ws`).
 *
 * Known frames are typed explicitly; anything else collapses into the
 * catch-all variant (`{ type: string; [key: string]: unknown }`) which
 * the socket manager ignores (after a `debugLog`).
 */
export type WsInbound =
  | { type: "connected"; user_id?: string }
  | { type: "pong" }
  | { type: "new_dialog_message"; chat_id: string; message_id: string; sender_id: string }
  | { type: "new_group_message"; chat_id: string; message_id: string; sender_id: string }
  | { type: string; [key: string]: unknown };

/** Lifecycle state of the events socket (for UI badges / polling fallback). */
export type WsStatus = "idle" | "connecting" | "open" | "retry" | "closed" | "unauthorized";

export interface EventsSocketOptions {
  getToken: () => string | null;
  buildUrl: (token: string) => string;
  onMessage: (m: WsInbound) => void;
  onStatus?: (s: WsStatus) => void;
  onUnauthorized?: () => void;
  /** Ping period in ms. Defaults to 25000. */
  pingIntervalMs?: number;
  /** First reconnect delay in ms. Defaults to 1000. */
  baseRetryMs?: number;
  /** Reconnect delay ceiling in ms. Defaults to 30000. */
  maxRetryMs?: number;
  /** Injectable WebSocket constructor (tests). Defaults to global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
}

export interface EventsSocket {
  close: () => void;
  reconnect: () => void;
  status: () => WsStatus;
}

/** Server asks to re-authenticate: no automatic reconnect after this code. */
const UNAUTHORIZED_CLOSE_CODE = 4401;

/** `WebSocket.OPEN` as a plain number (works with injected mocks). */
const WS_OPEN = 1;

/**
 * Framework-free WebSocket manager for the events channel.
 *
 * - No React / React Query imports — safe to use from any hook.
 * - No Tauri subscriptions here (the T4 hook wires `online`/`resumed`
 *   to {@link EventsSocket.reconnect} from the outside).
 * - All unexpected payloads / errors go to `debugLog`, never to console
 *   directly and never with the token attached.
 */
export function createEventsSocket(opts: EventsSocketOptions): EventsSocket {
  const pingIntervalMs = opts.pingIntervalMs ?? 25000;
  const baseRetryMs = opts.baseRetryMs ?? 1000;
  const maxRetryMs = opts.maxRetryMs ?? 30000;

  let current: WsStatus = "idle";
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelayMs = baseRetryMs;
  let disposed = false;
  let unauthorized = false;

  function setStatus(s: WsStatus): void {
    current = s;
    opts.onStatus?.(s);
  }

  function clearPing(): void {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function clearRetry(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry(): void {
    if (disposed || unauthorized) return;
    if (retryTimer !== null) return;
    const jitter = retryDelayMs * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(0, retryDelayMs + jitter);
    setStatus("retry");
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (disposed || unauthorized) return;
      connect();
    }, delay);
    retryDelayMs = Math.min(retryDelayMs * 2, maxRetryMs);
  }

  function startPing(socket: WebSocket): void {
    clearPing();
    pingTimer = setInterval(() => {
      try {
        if (socket.readyState === WS_OPEN) {
          socket.send("ping");
        }
      } catch (err) {
        void debugLog("ws.ping", err);
      }
    }, pingIntervalMs);
  }

  function handleFrame(raw: unknown): void {
    let parsed: unknown;
    try {
      if (typeof raw !== "string") {
        void debugLog("ws.message", new Error("non-string WS frame"), {
          kind: typeof raw,
        });
        return;
      }
      parsed = JSON.parse(raw) as unknown;
    } catch (err) {
      void debugLog("ws.message", err);
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      void debugLog("ws.message", new Error("WS frame is not an object"));
      return;
    }
    const type = (parsed as { type?: unknown }).type;
    if (typeof type !== "string") {
      void debugLog("ws.message", new Error("WS frame has no string type"));
      return;
    }
    switch (type) {
      case "connected":
        retryDelayMs = baseRetryMs;
        setStatus("open");
        return;
      case "pong":
        return;
      case "new_dialog_message":
      case "new_group_message":
        opts.onMessage(parsed as WsInbound);
        return;
      default:
        void debugLog("ws.message", new Error(`unknown WS frame type: ${type}`), { type });
        return;
    }
  }

  function handleClose(code: number): void {
    clearPing();
    if (ws !== null) {
      ws = null;
    }
    if (disposed) return;
    if (unauthorized) return;
    if (code === UNAUTHORIZED_CLOSE_CODE) {
      unauthorized = true;
      clearRetry();
      setStatus("unauthorized");
      opts.onUnauthorized?.();
      return;
    }
    scheduleRetry();
  }

  function connect(): void {
    if (disposed || unauthorized) return;
    clearRetry();
    const token = opts.getToken();
    if (token === null) {
      setStatus("idle");
      return;
    }
    let url: string;
    try {
      url = opts.buildUrl(token);
    } catch (err) {
      void debugLog("ws.buildUrl", err);
      setStatus("idle");
      return;
    }
    setStatus("connecting");
    const Impl = opts.WebSocketImpl ?? WebSocket;
    const socket = new Impl(url);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      startPing(socket);
    };
    socket.onmessage = (ev: MessageEvent) => {
      if (ws !== socket) return;
      handleFrame(ev.data as unknown);
    };
    socket.onerror = () => {
      if (ws !== socket) return;
      void debugLog("ws.error", new Error("WebSocket error"));
      if (socket.readyState !== WS_OPEN) {
        scheduleRetry();
      }
    };
    socket.onclose = (ev: CloseEvent) => {
      if (ws !== socket && ws !== null) return;
      handleClose(ev.code);
    };
  }

  function reconnect(): void {
    if (disposed) return;
    unauthorized = false;
    retryDelayMs = baseRetryMs;
    clearRetry();
    const old = ws;
    ws = null;
    clearPing();
    if (old !== null) {
      try {
        old.close();
      } catch (err) {
        void debugLog("ws.reconnect", err);
      }
    }
    connect();
  }

  function close(): void {
    if (disposed) return;
    disposed = true;
    clearRetry();
    clearPing();
    const old = ws;
    ws = null;
    if (old !== null) {
      try {
        old.close();
      } catch (err) {
        void debugLog("ws.close", err);
      }
    }
    setStatus("closed");
  }

  connect();

  return {
    close,
    reconnect,
    status: () => current,
  };
}
