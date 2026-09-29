import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAllEvents,
  getDialogEvents,
  getGroupEvents,
  markDialogRead,
  markGroupRead,
} from "@/features/events/api";
import { configureClient } from "@/infra/apiClient";

import { server } from "../../mocks/server";

describe("events/api", () => {
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

  describe("getDialogEvents", () => {
    it("calls GET /event/dialogs/ and returns the items list", async () => {
      let captured: { method: string; url: string } | null = null;
      server.use(
        http.get("http://localhost:8000/event/dialogs/", ({ request }) => {
          captured = { method: request.method, url: request.url };
          return HttpResponse.json({
            items: [
              { id: "evt-1", chat_id: "chat-1", user_id: "user-2", count: 3 },
              { id: "evt-2", chat_id: "chat-3", user_id: "user-3", count: 1 },
            ],
          });
        }),
      );

      const result = await getDialogEvents();

      expect(captured?.method).toBe("GET");
      expect(captured?.url).toContain("/event/dialogs/");
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        id: "evt-1",
        chat_id: "chat-1",
        user_id: "user-2",
        count: 3,
      });
      expect(result.items[1]?.count).toBe(1);
    });

    it("returns an empty list when the backend responds with no items", async () => {
      server.use(
        http.get("http://localhost:8000/event/dialogs/", () => HttpResponse.json({ items: [] })),
      );

      const result = await getDialogEvents();
      expect(result.items).toEqual([]);
    });
  });

  describe("getGroupEvents", () => {
    it("calls GET /event/groups/ and returns the items list", async () => {
      let captured: { method: string; url: string } | null = null;
      server.use(
        http.get("http://localhost:8000/event/groups/", ({ request }) => {
          captured = { method: request.method, url: request.url };
          return HttpResponse.json({
            items: [{ id: "gevt-1", chat_id: "group-1", user_id: "user-2", count: 7 }],
          });
        }),
      );

      const result = await getGroupEvents();

      expect(captured?.method).toBe("GET");
      expect(captured?.url).toContain("/event/groups/");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe("gevt-1");
      expect(result.items[0]?.count).toBe(7);
    });
  });

  describe("markDialogRead", () => {
    it("calls POST /event/dialog/readed/:eventId with an empty JSON body", async () => {
      let captured: {
        method: string;
        url: string;
        raw: string;
        contentType: string | null;
      } | null = null;

      server.use(
        http.post(
          "http://localhost:8000/event/dialog/readed/:eventId",
          async ({ request, params }) => {
            const raw = await request.text();
            captured = {
              method: request.method,
              url: request.url,
              raw,
              contentType: request.headers.get("Content-Type"),
            };
            expect(params.eventId).toBe("evt-1");
            return new HttpResponse("", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            });
          },
        ),
      );

      await markDialogRead("evt-1");

      expect(captured?.method).toBe("POST");
      expect(captured?.url).toContain("/event/dialog/readed/evt-1");
      expect(captured?.contentType).toBe("application/json");
      expect(captured?.raw).toBe("{}");
    });
  });

  describe("markGroupRead", () => {
    it("calls POST /event/group/readed/:eventId with an empty JSON body", async () => {
      let captured: {
        method: string;
        url: string;
        raw: string;
        contentType: string | null;
      } | null = null;

      server.use(
        http.post(
          "http://localhost:8000/event/group/readed/:eventId",
          async ({ request, params }) => {
            const raw = await request.text();
            captured = {
              method: request.method,
              url: request.url,
              raw,
              contentType: request.headers.get("Content-Type"),
            };
            expect(params.eventId).toBe("gevt-1");
            return new HttpResponse("", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            });
          },
        ),
      );

      await markGroupRead("gevt-1");

      expect(captured?.method).toBe("POST");
      expect(captured?.url).toContain("/event/group/readed/gevt-1");
      expect(captured?.contentType).toBe("application/json");
      expect(captured?.raw).toBe("{}");
    });
  });

  describe("getAllEvents", () => {
    it("fetches both dialog and group events in parallel and merges them into { dialog, group }", async () => {
      const dialogRequest = vi.fn();
      const groupRequest = vi.fn();

      server.use(
        http.get("http://localhost:8000/event/dialogs/", ({ request }) => {
          dialogRequest(request.method, request.url);
          return HttpResponse.json({
            items: [{ id: "e1", chat_id: "c1", user_id: "u1", count: 2 }],
          });
        }),
        http.get("http://localhost:8000/event/groups/", ({ request }) => {
          groupRequest(request.method, request.url);
          return HttpResponse.json({
            items: [{ id: "g1", chat_id: "gc1", user_id: "u2", count: 4 }],
          });
        }),
      );

      const result = await getAllEvents();

      expect(dialogRequest).toHaveBeenCalledTimes(1);
      expect(groupRequest).toHaveBeenCalledTimes(1);
      expect(result.dialog).toHaveLength(1);
      expect(result.group).toHaveLength(1);
      expect(result.dialog[0]?.id).toBe("e1");
      expect(result.group[0]?.id).toBe("g1");
    });

    it("returns empty arrays for both sides when the backend has no events", async () => {
      server.use(
        http.get("http://localhost:8000/event/dialogs/", () => HttpResponse.json({ items: [] })),
        http.get("http://localhost:8000/event/groups/", () => HttpResponse.json({ items: [] })),
      );

      const result = await getAllEvents();
      expect(result.dialog).toEqual([]);
      expect(result.group).toEqual([]);
    });
  });
});
