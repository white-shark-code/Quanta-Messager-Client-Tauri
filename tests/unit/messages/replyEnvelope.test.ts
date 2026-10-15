import { describe, expect, it } from "vitest";

import {
  REPLY_PREVIEW_LIMIT,
  decodeBody,
  encodeReplyBody,
  truncatePreview,
} from "@/features/messages/replyEnvelope";

describe("messages/replyEnvelope", () => {
  describe("encode/decode round-trip", () => {
    it("round-trips text and reply ref", () => {
      const encoded = encodeReplyBody("hello", {
        id: "msg-1",
        sender: "alice",
        preview: "parent text",
      });
      expect(decodeBody(encoded)).toEqual({
        text: "hello",
        reply: { id: "msg-1", sender: "alice", preview: "parent text" },
      });
    });

    it("keeps text as-is without trimming", () => {
      const encoded = encodeReplyBody("  padded  ", {
        id: "m",
        sender: "s",
        preview: "p",
      });
      expect(decodeBody(encoded).text).toBe("  padded  ");
    });
  });

  describe("decodeBody fallback", () => {
    it("decodes legacy plain text with reply null", () => {
      expect(decodeBody("just a message")).toEqual({
        text: "just a message",
        reply: null,
      });
    });

    it("falls back on broken JSON without throwing", () => {
      expect(() => decodeBody("{not json")).not.toThrow();
      expect(decodeBody("{not json")).toEqual({
        text: "{not json",
        reply: null,
      });
    });

    it("falls back when version is not 1", () => {
      const body = JSON.stringify({ v: 2, text: "hi" });
      expect(decodeBody(body)).toEqual({ text: body, reply: null });
    });

    it("keeps working for JSON plain messages without reply", () => {
      const body = JSON.stringify({ v: 1, text: '{"not": "reply"}' });
      expect(decodeBody(body)).toEqual({
        text: '{"not": "reply"}',
        reply: null,
      });
    });

    it("falls back when reply shape is invalid", () => {
      const body = JSON.stringify({
        v: 1,
        text: "hi",
        reply: { id: "m" },
      });
      expect(decodeBody(body)).toEqual({ text: body, reply: null });
    });

    it("falls back for JSON arrays and primitives", () => {
      for (const body of ["[1,2]", '"str"', "42", "null"]) {
        expect(decodeBody(body)).toEqual({ text: body, reply: null });
      }
    });
  });

  describe("preview truncation", () => {
    it("truncates preview at 200 chars on encode", () => {
      const long = "x".repeat(500);
      const decoded = decodeBody(encodeReplyBody("hi", { id: "m", sender: "s", preview: long }));
      expect(decoded.reply?.preview).toHaveLength(REPLY_PREVIEW_LIMIT);
      expect(decoded.reply?.preview).toBe(long.slice(0, 200));
    });

    it("truncatePreview slices to the limit", () => {
      expect(REPLY_PREVIEW_LIMIT).toBe(200);
      expect(truncatePreview("x".repeat(500))).toHaveLength(200);
      expect(truncatePreview("short")).toBe("short");
    });
  });
});
