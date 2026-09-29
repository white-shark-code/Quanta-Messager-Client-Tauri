import { describe, expect, it } from "vitest";

import { apiUrl, env } from "@/infra/env";

describe("infra/env — smoke", () => {
  it("module imports without throwing (VITE_API_URL is configured in vitest.config.ts)", () => {
    expect(env).toBeDefined();
    expect(typeof env.apiUrl).toBe("string");
    expect(env.apiUrl.length).toBeGreaterThan(0);
  });

  it("exposes isDev / isProd booleans that match import.meta.env", () => {
    expect(typeof env.isDev).toBe("boolean");
    expect(typeof env.isProd).toBe("boolean");
    // Vitest runs in test mode → DEV true, PROD false.
    expect(env.isDev).toBe(true);
    expect(env.isProd).toBe(false);
  });
});

describe("infra/env — apiUrl()", () => {
  it("joins a relative path with a single slash", () => {
    const base = env.apiUrl.replace(/\/+$/, "");
    expect(apiUrl("/v1/messages")).toBe(`${base}/v1/messages`);
    expect(apiUrl("v1/messages")).toBe(`${base}/v1/messages`);
  });

  it("strips trailing slashes from the base URL before joining", () => {
    // Even if env.apiUrl had trailing slashes, the joined result must
    // not contain double slashes between base and path.
    const joined = apiUrl("/health");
    expect(joined).not.toMatch(/\/\/health/);
    expect(joined.endsWith("/health")).toBe(true);
  });

  it("preserves a query string on the path", () => {
    const base = env.apiUrl.replace(/\/+$/, "");
    expect(apiUrl("/v1/users?limit=10")).toBe(`${base}/v1/users?limit=10`);
  });
});
