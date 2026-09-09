import { beforeEach, describe, expect, it } from "vitest";
import { getGroupMessages, getPrivateMessages, sendGroupMessage, sendPrivateMessage, } from "@/features/messages/api";
import { configureClient } from "@/infra/apiClient";
import { capturedMessageApi, resetMessageApiCaptures, } from "../../mocks/handlers";
import { server } from "../../mocks/server";
const CHAT_PRIVATE = "11111111-2222-3333-4444-555555555555";
const CHAT_GROUP = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CIPHERTEXT_B64 = "RW5jcnlwdGVkVGV4dEZyb21UZXN0";
const SIGNATURE_B64 = "RGV0YWNoZWRTaWduYXR1cmVGb3JUZXN0";
describe("messages/api", () => {
    beforeEach(() => {
        resetMessageApiCaptures();
        configureClient({
            tokenProvider: () => null,
            onUnauthorized: () => undefined,
        });
    });
    describe("getPrivateMessages", () => {
        it("GETs /messages/private-messages/{chatId} and returns the items envelope", async () => {
            const result = await getPrivateMessages(CHAT_PRIVATE);
            const captured = capturedMessageApi.privateList;
            expect(captured).not.toBeNull();
            expect(captured?.method).toBe("GET");
            expect(captured?.url).toContain(`/messages/private-messages/${CHAT_PRIVATE}`);
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.chat_id).toBe(CHAT_PRIVATE);
        });
        it("appends ?offset=10&limit=5 when both pagination params are provided", async () => {
            await getPrivateMessages(CHAT_PRIVATE, { offset: 10, limit: 5 });
            const captured = capturedMessageApi.privateList;
            expect(captured).not.toBeNull();
            expect(captured?.query.get("offset")).toBe("10");
            expect(captured?.query.get("limit")).toBe("5");
            expect(captured?.url).toContain("offset=10");
            expect(captured?.url).toContain("limit=5");
        });
        it("appends only the offset query when only offset is provided", async () => {
            await getPrivateMessages(CHAT_PRIVATE, { offset: 10 });
            const captured = capturedMessageApi.privateList;
            expect(captured).not.toBeNull();
            expect(captured?.query.get("offset")).toBe("10");
            expect(captured?.query.has("limit")).toBe(false);
        });
        it("appends no query string when an empty params object is passed", async () => {
            await getPrivateMessages(CHAT_PRIVATE, {});
            const captured = capturedMessageApi.privateList;
            expect(captured).not.toBeNull();
            expect(captured?.url).not.toContain("?");
            expect(Array.from(captured?.query.entries() ?? [])).toEqual([]);
        });
    });
    describe("sendPrivateMessage", () => {
        it("POSTs /messages/private-message/{chatId} with the encrypted_message and signature as base64 strings", async () => {
            const result = await sendPrivateMessage(CHAT_PRIVATE, {
                encrypted_message: CIPHERTEXT_B64,
                signature: SIGNATURE_B64,
            });
            const captured = capturedMessageApi.privateSend;
            expect(captured).not.toBeNull();
            expect(captured?.method).toBe("POST");
            expect(captured?.url).toContain(`/messages/private-message/${CHAT_PRIVATE}`);
            expect(captured?.url).not.toContain("?");
            const body = captured?.body;
            expect(body.encrypted_message).toBe(CIPHERTEXT_B64);
            expect(body.signature).toBe(SIGNATURE_B64);
            expect(result.chat_id).toBe(CHAT_PRIVATE);
        });
    });
    describe("getGroupMessages", () => {
        it("GETs /group-messages/group-message/{chatId}", async () => {
            const result = await getGroupMessages(CHAT_GROUP);
            const captured = capturedMessageApi.groupList;
            expect(captured).not.toBeNull();
            expect(captured?.method).toBe("GET");
            expect(captured?.url).toContain(`/group-messages/group-message/${CHAT_GROUP}`);
            expect(result.items[0]?.chat_id).toBe(CHAT_GROUP);
        });
    });
    describe("sendGroupMessage", () => {
        it("POSTs /group-messages/group-message/{chatId} with the encrypted_message and signature as base64 strings", async () => {
            const result = await sendGroupMessage(CHAT_GROUP, {
                encrypted_message: CIPHERTEXT_B64,
                signature: SIGNATURE_B64,
            });
            const captured = capturedMessageApi.groupSend;
            expect(captured).not.toBeNull();
            expect(captured?.method).toBe("POST");
            expect(captured?.url).toContain(`/group-messages/group-message/${CHAT_GROUP}`);
            expect(captured?.url).not.toContain("?");
            const body = captured?.body;
            expect(body.encrypted_message).toBe(CIPHERTEXT_B64);
            expect(body.signature).toBe(SIGNATURE_B64);
            expect(result.chat_id).toBe(CHAT_GROUP);
        });
    });
    it("no captured request leaks between tests", () => {
        expect(capturedMessageApi.privateList).toBeNull();
        expect(capturedMessageApi.privateSend).toBeNull();
        expect(capturedMessageApi.groupList).toBeNull();
        expect(capturedMessageApi.groupSend).toBeNull();
        expect(server.listHandlers().length).toBeGreaterThan(0);
    });
});
