import { describe, expect, it } from "vitest";

import {
  decodeBody,
  encodeForwardBody,
  encodeReplyBody,
  stripForForward,
} from "@/features/messages/replyEnvelope";

describe("messages/forwardEnvelope", () => {
  describe("forwarded round-trip", () => {
    it("round-trips text and forward origin with reply null", () => {
      const encoded = encodeForwardBody("hello", { fromChat: "chat-1", fromMsg: "msg-1" });
      expect(decodeBody(encoded)).toEqual({
        text: "hello",
        reply: null,
        forwarded: { fromChat: "chat-1", fromMsg: "msg-1" },
      });
    });

    it("keeps text as-is without trimming", () => {
      const encoded = encodeForwardBody("  padded  ", { fromChat: "c", fromMsg: "m" });
      expect(decodeBody(encoded).text).toBe("  padded  ");
    });

    it("reply envelopes decode with forwarded null (backward compatible)", () => {
      const encoded = encodeReplyBody("hi", { id: "m", sender: "s", preview: "p" });
      expect(decodeBody(encoded)).toEqual({
        text: "hi",
        reply: { id: "m", sender: "s", preview: "p" },
        forwarded: null,
      });
    });
  });

  describe("decodeBody fallback", () => {
    it("decodes legacy plain text with all null", () => {
      expect(decodeBody("just a message")).toEqual({
        text: "just a message",
        reply: null,
        forwarded: null,
      });
    });

    it("falls back on broken JSON without throwing", () => {
      expect(() => decodeBody("{not json")).not.toThrow();
      expect(decodeBody("{not json")).toEqual({
        text: "{not json",
        reply: null,
        forwarded: null,
      });
    });

    it("falls back when version is not 1", () => {
      const body = JSON.stringify({
        v: 2,
        text: "hi",
        forwarded: { fromChat: "c", fromMsg: "m" },
      });
      expect(decodeBody(body)).toEqual({ text: body, reply: null, forwarded: null });
    });

    it("unwraps v1 text without reply/forwarded keys", () => {
      const body = JSON.stringify({ v: 1, text: '{"not": "forward"}' });
      expect(decodeBody(body)).toEqual({
        text: '{"not": "forward"}',
        reply: null,
        forwarded: null,
      });
    });

    it("falls back when forwarded shape is invalid", () => {
      const body = JSON.stringify({ v: 1, text: "hi", forwarded: { fromChat: "c" } });
      expect(decodeBody(body)).toEqual({ text: body, reply: null, forwarded: null });
    });
  });

  describe("stripForForward", () => {
    it("drops the reply link but keeps text", () => {
      expect(
        stripForForward({
          text: "body",
          reply: { id: "m", sender: "s", preview: "p" },
        }),
      ).toEqual({ text: "body" });
    });

    it("passes plain text through", () => {
      expect(stripForForward({ text: "plain", reply: null })).toEqual({ text: "plain" });
    });
  });
});
