import { afterEach, describe, expect, it, vi } from "vitest";

import { buildWsUrl, buildWsUrlFromEnv } from "@/features/events/wsUrl";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("events/wsUrl — buildWsUrl", () => {
  it("converts an http:// base to ws:// and appends /event/ws?token=", () => {
    expect(buildWsUrl("http://localhost:8000", "abc")).toBe(
      "ws://localhost:8000/event/ws?token=abc",
    );
  });

  it("converts an https:// base to wss://", () => {
    expect(buildWsUrl("https://example.com", "abc")).toBe("wss://example.com/event/ws?token=abc");
  });

  it("keeps ws:// and wss:// bases as-is", () => {
    expect(buildWsUrl("ws://localhost:8000", "abc")).toBe("ws://localhost:8000/event/ws?token=abc");
    expect(buildWsUrl("wss://example.com", "abc")).toBe("wss://example.com/event/ws?token=abc");
  });

  it("trims trailing slashes (including repeated ones) from the base", () => {
    expect(buildWsUrl("http://localhost:8000///", "abc")).toBe(
      "ws://localhost:8000/event/ws?token=abc",
    );
    expect(buildWsUrl("https://example.com/api/", "abc")).toBe(
      "wss://example.com/api/event/ws?token=abc",
    );
  });

  it("URL-encodes the token with encodeURIComponent", () => {
    const token = "a+b/c=d?e&f";
    expect(buildWsUrl("http://localhost:8000", token)).toBe(
      `ws://localhost:8000/event/ws?token=${encodeURIComponent(token)}`,
    );
  });

  it("prefers a non-empty VITE_WS_URL override over apiBase", () => {
    vi.stubEnv("VITE_WS_URL", "wss://override.example:9000");
    expect(buildWsUrl("http://localhost:8000", "tok")).toBe(
      "wss://override.example:9000/event/ws?token=tok",
    );
  });

  it("converts an http:// VITE_WS_URL override to ws://", () => {
    vi.stubEnv("VITE_WS_URL", "http://override.example:9000/");
    expect(buildWsUrl("https://ignored.example", "tok")).toBe(
      "ws://override.example:9000/event/ws?token=tok",
    );
  });

  it("falls back to apiBase when VITE_WS_URL is an empty string", () => {
    vi.stubEnv("VITE_WS_URL", "");
    expect(buildWsUrl("http://localhost:8000", "tok")).toBe(
      "ws://localhost:8000/event/ws?token=tok",
    );
  });

  it("throws a readable error when the token is empty", () => {
    expect(() => buildWsUrl("http://localhost:8000", "")).toThrow(/token/i);
  });

  it("throws a readable error when both the override and apiBase are empty", () => {
    vi.stubEnv("VITE_WS_URL", "");
    expect(() => buildWsUrl("", "tok")).toThrow(/base URL|apiBase|VITE_WS_URL/i);
  });

  it("throws when VITE_WS_URL is set but the token is empty", () => {
    vi.stubEnv("VITE_WS_URL", "wss://override.example");
    expect(() => buildWsUrl("http://localhost:8000", "")).toThrow(/token/i);
  });
});

describe("events/wsUrl — buildWsUrlFromEnv", () => {
  it("builds the URL from VITE_API_URL when no override is set", () => {
    // vitest.config.ts sets VITE_API_URL=http://localhost:8000 for tests.
    expect(buildWsUrlFromEnv("abc")).toBe("ws://localhost:8000/event/ws?token=abc");
  });
});
