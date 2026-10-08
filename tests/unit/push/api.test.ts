import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getMeta, subscribePush, unsubscribePush } from "@/features/push/api";
import { configureClient } from "@/infra/apiClient";

import { server } from "../../mocks/server";

describe("push/api", () => {
  beforeEach(() => {
    configureClient({
      tokenProvider: () => "test-token",
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
    it("calls GET /meta and returns the VAPID public key", async () => {
      server.use(
        http.get("http://localhost:8000/meta", () =>
          HttpResponse.json({ vapid_public_key: "test-vapid-key" }),
        ),
      );

      const meta = await getMeta();

      expect(meta.vapid_public_key).toBe("test-vapid-key");
    });

    it("passes through an empty key (VAPID not configured)", async () => {
      server.use(
        http.get("http://localhost:8000/meta", () => HttpResponse.json({ vapid_public_key: "" })),
      );

      const meta = await getMeta();

      expect(meta.vapid_public_key).toBe("");
    });
  });

  describe("subscribePush", () => {
    it("POSTs endpoint + keys to /push/subscribe", async () => {
      let captured: unknown = null;
      server.use(
        http.post("http://localhost:8000/push/subscribe", async ({ request }) => {
          captured = await request.json();
          return HttpResponse.json({ endpoint: "https://push.example/sub-1" }, { status: 201 });
        }),
      );

      const result = await subscribePush("https://push.example/sub-1", "p256dh-key", "auth-key");

      expect(captured).toEqual({
        endpoint: "https://push.example/sub-1",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      });
      expect(result.endpoint).toBe("https://push.example/sub-1");
    });
  });

  describe("unsubscribePush", () => {
    it("sends DELETE /push/unsubscribe with a JSON body", async () => {
      let captured: { method: string; body: unknown } | null = null;
      server.use(
        http.delete("http://localhost:8000/push/unsubscribe", async ({ request }) => {
          captured = { method: request.method, body: await request.json() };
          return new HttpResponse(null, { status: 204 });
        }),
      );

      await unsubscribePush("https://push.example/sub-1");

      expect(captured?.method).toBe("DELETE");
      expect(captured?.body).toEqual({ endpoint: "https://push.example/sub-1" });
    });
  });
});
