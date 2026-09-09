import { describe, expect, it } from "vitest";

import type { DialogMessage } from "@/features/messages/model";
import {
  bytesToBase64,
  isPendingMessage,
  messagesQueryKey,
  type PendingMessage,
} from "@/features/messages/mutations";

describe("messages/mutations pure helpers", () => {
  describe("bytesToBase64", () => {
    it("encodes ASCII bytes for 'Hello' to base64 'SGVsbG8='", () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]);
      expect(bytesToBase64(bytes)).toBe("SGVsbG8=");
    });

    it("encodes an empty Uint8Array to the empty string", () => {
      expect(bytesToBase64(new Uint8Array(0))).toBe("");
    });

    it("round-trips a 50k deterministic byte array via atob", () => {
      let seed = 0x12345678;
      const next = (): number => {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
        return seed % 256;
      };
      const bytes = new Uint8Array(50_000);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = next();
      }
      const encoded = bytesToBase64(bytes);
      expect(encoded.length).toBeGreaterThan(0);
      const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      expect(decoded).toEqual(bytes);
    });

    it("does not throw on arrays larger than the 0x8000 chunk size", () => {
      const bytes = new Uint8Array(0x8000 + 1);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (i * 13) & 0xff;
      }
      expect(() => bytesToBase64(bytes)).not.toThrow();
      const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
      expect(decoded).toEqual(bytes);
    });
  });

  describe("messagesQueryKey", () => {
    it("returns ['messages', 'private', chatId] for kind 'private'", () => {
      expect(messagesQueryKey("private", "abc")).toEqual(["messages", "private", "abc"]);
    });

    it("returns ['messages', 'group', chatId] for kind 'group'", () => {
      expect(messagesQueryKey("group", "xyz")).toEqual(["messages", "group", "xyz"]);
    });

    it("returns a readonly tuple distinct on every call", () => {
      const a = messagesQueryKey("private", "chat-1");
      const b = messagesQueryKey("private", "chat-1");
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe("isPendingMessage", () => {
    const baseMessage: DialogMessage = {
      id: "m1",
      chat_id: "c1",
      owner_id: "user-1",
      encrypted_message: "ZW5jcnlwdGVk",
      signature: "c2ln",
      creation_datetime: "2026-09-08T00:00:00Z",
    };

    it("returns false for a regular DialogMessage without an optimistic flag", () => {
      expect(isPendingMessage(baseMessage)).toBe(false);
    });

    it("returns true for a PendingMessage with optimistic=true and status='pending'", () => {
      const pending: PendingMessage = {
        ...baseMessage,
        id: "optimistic-uuid-1",
        status: "pending",
        text: "hello",
        createdAt: 1_690_000_000_000,
        optimistic: true,
      };
      expect(isPendingMessage(pending)).toBe(true);
    });
  });
});
