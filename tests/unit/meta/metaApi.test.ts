import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_REGISTRATION_MODE,
  getMeta,
  resolveRegistrationMode,
  type ServerMeta,
} from "@/features/meta/api";
import { configureClient } from "@/infra/apiClient";

import { server } from "../../mocks/server";

describe("meta/api", () => {
  beforeEach(() => {
    configureClient({
      tokenProvider: () => null,
      onUnauthorized: () => undefined,
    });
  });

  afterEach(() => {
    configureClient({
      tokenProvider: () => null,
      onUnauthorized: () => undefined,
    });
  });

  describe("getMeta", () => {
    it("calls GET /meta and returns the parsed payload", async () => {
      server.use(
        http.get("http://localhost:8000/meta", () =>
          HttpResponse.json({
            vapid_public_key: "test-vapid-key",
            registration_mode: "open",
          }),
        ),
      );

      const meta = await getMeta();

      expect(meta).toEqual({
        vapid_public_key: "test-vapid-key",
        registration_mode: "open",
      });
    });
  });

  describe("DEFAULT_REGISTRATION_MODE", () => {
    it("is approval (matches the server default)", () => {
      expect(DEFAULT_REGISTRATION_MODE).toBe("approval");
    });
  });

  describe("resolveRegistrationMode", () => {
    it("returns approval for undefined meta", () => {
      expect(resolveRegistrationMode(undefined)).toBe("approval");
    });

    it("returns approval when registration_mode is missing", () => {
      const meta = { vapid_public_key: "key" } as ServerMeta;
      expect(resolveRegistrationMode(meta)).toBe("approval");
    });

    it("passes through each valid registration_mode", () => {
      const modes = ["open", "approval", "closed"] as const;
      for (const mode of modes) {
        expect(resolveRegistrationMode({ vapid_public_key: "key", registration_mode: mode })).toBe(
          mode,
        );
      }
    });

    it("falls back to approval for an uninitialized/garbage value", () => {
      expect(
        resolveRegistrationMode({
          vapid_public_key: "key",
          registration_mode: "whatever" as ServerMeta["registration_mode"],
        }),
      ).toBe("approval");
    });
  });
});
