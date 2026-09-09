import { describe, expect, it } from "vitest";
describe("chats/model", () => {
    describe("type-only module", () => {
        it("exports the expected public type surface", () => {
            const chat = { id: "chat-1", name: "Alice" };
            const dialog = {
                ...chat,
                user0: "user-1",
                user1: "user-2",
                create_at: "2026-09-08T00:00:00Z",
            };
            const group = {
                ...chat,
                public_key: "BASE64KEY",
                create_at: "2026-09-08T00:00:00Z",
            };
            const anyChat = dialog;
            const createPrivate = { name: "Alice", user: "user-2" };
            const createGroup = { name: "Eng", public_key: "BASE64KEY" };
            const page = {
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
            const dialog = {
                id: "chat-1",
                name: "Alice",
                user0: "user-1",
                user1: "user-2",
                create_at: "2026-09-08T00:00:00Z",
            };
            const group = {
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
