import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createGroupChat,
  createPrivateChat,
  deletePrivateChat,
  getAllGroupChats,
  getAllPrivateChats,
  getPrivateChat,
  isGroupChat,
} from "@/features/chats/api";
import { configureClient } from "@/infra/apiClient";
import type { DialogChat, GroupChat } from "@/features/chats/model";

import { server } from "../../mocks/server";

describe("chats/api", () => {
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

  describe("getAllPrivateChats", () => {
    it("calls GET /messages/private-chats/ with default page_size when no params are provided", async () => {
      let captured: { method: string; url: string; auth: string | null } | null = null;

      server.use(
        http.get("http://localhost:8000/messages/private-chats/", ({ request }) => {
          captured = {
            method: request.method,
            url: request.url,
            auth: request.headers.get("Authorization"),
          };
          return HttpResponse.json({
            page_size: 50,
            count_pages: 1,
            items: [],
            last_id: null,
          });
        }),
      );

      const result = await getAllPrivateChats();

      expect(captured).not.toBeNull();
      expect(captured?.method).toBe("GET");
      expect(captured?.url).toContain("/messages/private-chats/");
      expect(captured?.url).toContain("page_size=50");
      expect(captured?.url).not.toContain("last_id");
      expect(captured?.auth).toBe("Bearer test-token");
      expect(result.page_size).toBe(50);
      expect(result.items).toEqual([]);
      expect(result.last_id).toBeNull();
    });

    it("forwards last_id and custom page_size as query params", async () => {
      let capturedUrl: string | null = null;
      server.use(
        http.get("http://localhost:8000/messages/private-chats/", ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({
            page_size: 5,
            count_pages: 1,
            items: [],
            last_id: null,
          });
        }),
      );

      await getAllPrivateChats({ last_id: "11111111-1111-4111-8111-111111111111", page_size: 5 });

      expect(capturedUrl).not.toBeNull();
      const url = new URL(capturedUrl as unknown as string);
      expect(url.pathname).toBe("/messages/private-chats/");
      expect(url.searchParams.get("last_id")).toBe("11111111-1111-4111-8111-111111111111");
      expect(url.searchParams.get("page_size")).toBe("5");
    });

    it("parses the paginated response shape", async () => {
      const sample: DialogChat = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Alice",
        user0: "user-1",
        user1: "user-2",
        create_at: "2026-09-08T12:34:56.000Z",
      };

      server.use(
        http.get("http://localhost:8000/messages/private-chats/", () =>
          HttpResponse.json({
            page_size: 50,
            count_pages: 3,
            items: [sample],
            last_id: "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz",
          }),
        ),
      );

      const result = await getAllPrivateChats();
      expect(result.count_pages).toBe(3);
      expect(result.last_id).toBe("zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(sample);
    });
  });

  describe("getPrivateChat", () => {
    it("calls GET /messages/private-chat/:chatId and returns a DialogChat", async () => {
      let captured: { method: string; url: string } | null = null;
      server.use(
        http.get("http://localhost:8000/messages/private-chat/:chatId", ({ request, params }) => {
          captured = { method: request.method, url: request.url };
          return HttpResponse.json({
            id: params["chatId"],
            name: "Bob",
            user0: "user-1",
            user1: "user-2",
            create_at: "2026-09-08T00:00:00Z",
          });
        }),
      );

      const chat = await getPrivateChat("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

      expect(captured?.method).toBe("GET");
      expect(captured?.url).toContain("/messages/private-chat/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      expect(chat.id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      expect(chat.user0).toBe("user-1");
      expect(chat.user1).toBe("user-2");
    });
  });

  describe("createPrivateChat", () => {
    it("calls POST /messages/private-chat/ with the request body and parses the response", async () => {
      let captured: { method: string; raw: string } | null = null;
      server.use(
        http.post("http://localhost:8000/messages/private-chat/", async ({ request }) => {
          captured = { method: request.method, raw: await request.text() };
          return HttpResponse.json({
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            name: "Charlie",
            user0: "user-1",
            user1: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            create_at: "2026-09-08T00:00:00Z",
          });
        }),
      );

      const chat = await createPrivateChat({
        name: "Charlie",
        user: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      });

      expect(captured).not.toBeNull();
      expect(captured?.method).toBe("POST");
      const parsed = JSON.parse(captured?.raw ?? "{}") as {
        name: string;
        user: string;
      };
      expect(parsed).toEqual({
        name: "Charlie",
        user: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      });
      expect(chat.id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
      expect(chat.name).toBe("Charlie");
    });
  });

  describe("deletePrivateChat", () => {
    it("calls DELETE /messages/private-chat/:chatId/ with a trailing slash", async () => {
      let captured: { method: string; url: string } | null = null;
      server.use(
        http.delete(
          "http://localhost:8000/messages/private-chat/:chatId/",
          ({ request }) => {
            captured = { method: request.method, url: request.url };
            return HttpResponse.json({
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              name: "deleted",
              user0: "user-1",
              user1: "user-2",
              create_at: "2026-09-08T00:00:00Z",
            });
          },
        ),
      );

      const chat = await deletePrivateChat("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

      expect(captured?.method).toBe("DELETE");
      expect(captured?.url).toContain("/messages/private-chat/dddddddd-dddd-4ddd-8ddd-dddddddddddd/");
      expect(chat.id).toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    });
  });

  describe("getAllGroupChats", () => {
    it("calls GET /group-messages/group-chats/ with default page_size", async () => {
      let captured: { method: string; url: string } | null = null;
      server.use(
        http.get("http://localhost:8000/group-messages/group-chats/", ({ request }) => {
          captured = { method: request.method, url: request.url };
          return HttpResponse.json({
            page_size: 50,
            count_pages: 1,
            items: [],
            last_id: null,
          });
        }),
      );

      await getAllGroupChats();

      expect(captured?.method).toBe("GET");
      expect(captured?.url).toContain("/group-messages/group-chats/");
      expect(captured?.url).toContain("page_size=50");
    });

    it("forwards last_id and page_size to /group-messages/group-chats/", async () => {
      let capturedUrl: string | null = null;
      server.use(
        http.get("http://localhost:8000/group-messages/group-chats/", ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({
            page_size: 10,
            count_pages: 1,
            items: [],
            last_id: null,
          });
        }),
      );

      await getAllGroupChats({
        last_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        page_size: 10,
      });

      const url = new URL(capturedUrl as unknown as string);
      expect(url.searchParams.get("last_id")).toBe("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
      expect(url.searchParams.get("page_size")).toBe("10");
    });

    it("returns a paginated list of group chats", async () => {
      const sample: GroupChat = {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        name: "Engineering",
        public_key: "BASE64PUBLICKEY",
        create_at: "2026-09-08T00:00:00Z",
      };

      server.use(
        http.get("http://localhost:8000/group-messages/group-chats/", () =>
          HttpResponse.json({
            page_size: 50,
            count_pages: 1,
            items: [sample],
            last_id: null,
          }),
        ),
      );

      const result = await getAllGroupChats();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(sample);
    });
  });

  describe("createGroupChat", () => {
    it("calls POST /group-messages/group-chat/ with the request body and returns a GroupChat", async () => {
      let captured: { method: string; raw: string } | null = null;
      server.use(
        http.post(
          "http://localhost:8000/group-messages/group-chat/",
          async ({ request }) => {
            captured = { method: request.method, raw: await request.text() };
            return HttpResponse.json({
              id: "11111111-aaaa-4aaa-8aaa-111111111111",
              name: "Engineering",
              public_key: "BASE64PUBLICKEY",
              create_at: "2026-09-08T00:00:00Z",
            });
          },
        ),
      );

      const group = await createGroupChat({
        name: "Engineering",
        public_key: "BASE64PUBLICKEY",
      });

      expect(captured?.method).toBe("POST");
      const parsed = JSON.parse(captured?.raw ?? "{}") as {
        name: string;
        public_key: string;
      };
      expect(parsed).toEqual({ name: "Engineering", public_key: "BASE64PUBLICKEY" });
      expect(group.id).toBe("11111111-aaaa-4aaa-8aaa-111111111111");
      expect(group.public_key).toBe("BASE64PUBLICKEY");
    });
  });

  describe("isGroupChat", () => {
    it("returns true for a chat with a public_key field", () => {
      const group: GroupChat = {
        id: "group-1",
        name: "Engineering",
        public_key: "BASE64KEY",
        create_at: "2026-09-08T00:00:00Z",
      };

      expect(isGroupChat(group)).toBe(true);
    });

    it("returns false for a dialog chat without public_key", () => {
      const dialog: DialogChat = {
        id: "chat-1",
        name: "Alice",
        user0: "user-1",
        user1: "user-2",
        create_at: "2026-09-08T00:00:00Z",
      };

      expect(isGroupChat(dialog)).toBe(false);
    });

    it("narrows the type to GroupChat when returning true", () => {
      const group: GroupChat = {
        id: "group-x",
        name: "X",
        public_key: "KEY",
        create_at: "2026-09-08T00:00:00Z",
      };

      if (isGroupChat(group)) {
        const key: string = group.public_key;
        expect(key).toBe("KEY");
      } else {
        throw new Error("expected group narrowing");
      }
    });
  });
});
