import { describe, expect, it } from "vitest";

import type {
  AnyChat,
  Chat,
  CreateGroupChatRequest,
  CreatePrivateChatRequest,
  DialogChat,
  GroupChat,
  PaginatedResponse,
} from "@/features/chats/model";

describe("chats/model", () => {
  describe("type-only module", () => {
    it("exports the expected public type surface", () => {
      const chat: Chat = { id: "chat-1", name: "Alice" };
      const dialog: DialogChat = {
        ...chat,
        user0: "user-1",
        user1: "user-2",
        create_at: "2026-09-08T00:00:00Z",
      };
      const group: GroupChat = {
        ...chat,
        public_key: "BASE64KEY",
        create_at: "2026-09-08T00:00:00Z",
      };
      const anyChat: AnyChat = dialog;
      const createPrivate: CreatePrivateChatRequest = { name: "Alice", user: "user-2" };
      const createGroup: CreateGroupChatRequest = { name: "Eng", public_key: "BASE64KEY" };
      const page: PaginatedResponse<DialogChat> = {
        page_size: 50,
        count_pages: 1,
        items: [dialog],
        last_id: null,
      };

      expect(chat.id).toBe("chat-1");
      expect(dialog.user0).toBe("user-1");
      expect(group.public_key).toBe("BASE64KEY");
      expect(anyChat).toBe(dialog);
      expect(createPrivate.name).toBe("Alice");
      expect(createGroup.public_key).toBe("BASE64KEY");
      expect(page.items).toHaveLength(1);
      expect(page.last_id).toBeNull();
    });

    it("exposes the runtime guard helper through the api re-export", async () => {
      const { isGroupChat } = await import("@/features/chats/api");
      expect(typeof isGroupChat).toBe("function");

      const dialog: DialogChat = {
        id: "chat-1",
        name: "Alice",
        user0: "user-1",
        user1: "user-2",
        create_at: "2026-09-08T00:00:00Z",
      };
      const group: GroupChat = {
        id: "group-1",
        name: "Eng",
        public_key: "KEY",
        create_at: "2026-09-08T00:00:00Z",
      };

      expect(isGroupChat(dialog)).toBe(false);
      expect(isGroupChat(group)).toBe(true);
    });
  });
});
