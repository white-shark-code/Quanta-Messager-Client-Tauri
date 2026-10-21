import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEventsSocket, type EventsSocket } from "@/features/events/socket";

vi.mock("@/lib/debug", () => ({
  debugLog: vi.fn(() => Promise.resolve()),
}));

/**
 * Controllable WebSocket double. Mirrors the small surface
 * `createEventsSocket` actually uses (`send` / `close` plus the
 * `onopen` / `onmessage` / `onclose` / `onerror` slots) and records
 * every constructed instance so tests can drive reconnects.
 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = 0;
  readonly sent: string[] = [];
  closeCalls = 0;

  onopen: (() => void) | null = null;
  onmessage: (ev: { data: string }) => void = () => undefined;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
  }

  /** Simulate a successful TCP/TLS + WS handshake. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Simulate one inbound text frame (object → JSON, string → raw). */
  receive(payload: unknown): void {
    this.onmessage({ data: typeof payload === "string" ? payload : JSON.stringify(payload) });
  }

  /** Simulate the server closing the connection with a WS status code. */
  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const MockWsImpl = MockWebSocket as unknown as typeof WebSocket;

function latest(): MockWebSocket {
  const inst = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (inst === undefined) throw new Error("test bug: no WebSocket instance created yet");
  return inst;
}

interface Harness {
  sock: EventsSocket;
  onMessage: ReturnType<typeof vi.fn>;
  onStatus: ReturnType<typeof vi.fn>;
  onUnauthorized: ReturnType<typeof vi.fn>;
}

function makeSocket(): Harness {
  const onMessage = vi.fn();
  const onStatus = vi.fn();
  const onUnauthorized = vi.fn();
  const sock = createEventsSocket({
    getToken: () => "tok",
    buildUrl: (t) => `ws://example/event/ws?token=${t}`,
    onMessage,
    onStatus,
    onUnauthorized,
    pingIntervalMs: 1000,
    baseRetryMs: 1000,
    maxRetryMs: 8000,
    WebSocketImpl: MockWsImpl,
  });
  return { sock, onMessage, onStatus, onUnauthorized };
}

const liveSockets: EventsSocket[] = [];

beforeEach(() => {
  MockWebSocket.instances = [];
  liveSockets.length = 0;
  // Kill the ±20% reconnect jitter so backoff delays are exact.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.useFakeTimers();
});

afterEach(() => {
  for (const s of liveSockets) {
    try {
      s.close();
    } catch {
      // close() must never throw; ignore here either way.
    }
  }
  liveSockets.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("events/socket", () => {
  it("connected frame → status open, onMessage NOT called; pong is ignored", () => {
    const h = makeSocket();
    liveSockets.push(h.sock);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(h.onStatus).toHaveBeenCalledWith("connecting");

    latest().open();
    latest().receive({ type: "connected", user_id: "u-1" });

    expect(h.sock.status()).toBe("open");
    expect(h.onStatus).toHaveBeenCalledWith("open");
    expect(h.onMessage).not.toHaveBeenCalled();

    latest().receive({ type: "pong" });
    expect(h.onMessage).not.toHaveBeenCalled();
  });

  it("sends a ping on every ping interval while the socket is open", () => {
    const h = makeSocket();
    liveSockets.push(h.sock);
    latest().open();

    expect(latest().sent).toEqual([]);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(latest().sent).toEqual(["ping", "ping", "ping"]);
  });

  it("routes new_dialog_message frames to onMessage", () => {
    const h = makeSocket();
    liveSockets.push(h.sock);
    latest().open();
    latest().receive({ type: "connected" });

    const frame = {
      type: "new_dialog_message",
      chat_id: "chat-1",
      message_id: "m-1",
      sender_id: "u-2",
    };
    latest().receive(frame);

    expect(h.onMessage).toHaveBeenCalledTimes(1);
    expect(h.onMessage).toHaveBeenCalledWith(frame);
  });

  it("routes new_dialog_chat frames to onMessage", () => {
    const h = makeSocket();
    liveSockets.push(h.sock);
    latest().open();
    latest().receive({ type: "connected" });

    const frame = {
      type: "new_dialog_chat",
      chat_id: "chat-9",
      creator_id: "u-3",
    };
    latest().receive(frame);

    expect(h.onMessage).toHaveBeenCalledTimes(1);
    expect(h.onMessage).toHaveBeenCalledWith(frame);
  });

  it("ignores broken JSON frames without calling onMessage", () => {
    const h = makeSocket();
    liveSockets.push(h.sock);
    latest().open();
    latest().receive({ type: "connected" });

    latest().receive("{not-json");
    latest().receive("42");
    latest().receive({ noType: true });

    expect(h.onMessage).not.toHaveBeenCalled();
    expect(h.sock.status()).toBe("open");
  });

  it("close 4401 → onUnauthorized, status unauthorized, NO retry", () => {
    const h = makeSocket();
    liveSockets.push(h.sock);
    latest().open();
    latest().receive({ type: "connected" });

    latest().serverClose(4401);

    expect(h.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(h.sock.status()).toBe("unauthorized");
    expect(h.onStatus).toHaveBeenCalledWith("unauthorized");

    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("ordinary close → retry status and reconnect with exponential backoff", () => {
    const h = makeSocket();
    liveSockets.push(h.sock);
    latest().open();
    latest().receive({ type: "connected" });

    latest().serverClose(1006);

    expect(h.onUnauthorized).not.toHaveBeenCalled();
    expect(h.sock.status()).toBe("retry");
    expect(h.onStatus).toHaveBeenCalledWith("retry");

    // First retry after baseRetryMs (1000ms, jitter mocked to 0).
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(h.onStatus).toHaveBeenLastCalledWith("connecting");

    // Second consecutive failure backs off to 2× baseRetryMs.
    latest().open();
    latest().serverClose(1006);
    vi.advanceTimersByTime(1999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("close() is idempotent: one underlying close, status closed, no retry", () => {
    const h = makeSocket();
    liveSockets.push(h.sock);
    latest().open();
    latest().receive({ type: "connected" });

    h.sock.close();
    h.sock.close();

    expect(latest().closeCalls).toBe(1);
    expect(h.sock.status()).toBe("closed");

    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
