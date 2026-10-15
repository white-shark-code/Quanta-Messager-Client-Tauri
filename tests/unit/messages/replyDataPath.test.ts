import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DialogMessage } from "@/features/messages/model";
import {
  buildSendBody,
  isPendingMessage,
  messagesQueryKey,
  resolveReplyRef,
  type MessagesCache,
  type PendingMessage,
} from "@/features/messages/mutations";
import { getDecrypted } from "@/features/messages/queries";
import {
  REPLY_PREVIEW_LIMIT,
  decodeBody,
  encodeReplyBody,
  truncatePreview,
} from "@/features/messages/replyEnvelope";

const previewStub = vi.hoisted(() => ({ map: new Map<string, string>() }));

vi.mock("@/features/messages/queries", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/features/messages/queries")>();
  return {
    ...orig,
    getDecrypted: (id: string) => {
      const text = previewStub.map.get(id);
      return text === undefined ? undefined : { text, verified: true, reply: null };
    },
  };
});

function makeServerRow(overrides: Partial<DialogMessage> = {}): DialogMessage {
  return {
    id: "parent-1",
    chat_id: "chat-1",
    owner_id: "user-bob",
    encrypted_message: "ZW5j",
    signature: "c2ln",
    creation_datetime: "2026-09-08T00:00:00Z",
    ...overrides,
  };
}

function makePendingRow(overrides: Partial<PendingMessage> = {}): PendingMessage {
  return {
    ...makeServerRow({ id: "optimistic-1" }),
    status: "pending",
    text: "unsent draft",
    createdAt: Date.now(),
    optimistic: true,
    ...overrides,
  };
}

function seedCache(
  client: QueryClient,
  kind: "private" | "group",
  chatId: string,
  items: DialogMessage[],
): void {
  const cache: MessagesCache = { pages: [{ items }], pageParams: [0] };
  client.setQueryData(messagesQueryKey(kind, chatId), cache);
}

describe("replyEnvelope", () => {
  it("round-trips text + reply ref through encode/decode", () => {
    const body = encodeReplyBody("hello", { id: "p1", sender: "bob", preview: "parent text" });
    const parsed = decodeBody(body);
    expect(parsed.text).toBe("hello");
    expect(parsed.reply).toEqual({ id: "p1", sender: "bob", preview: "parent text" });
  });

  it("slices the preview to REPLY_PREVIEW_LIMIT on encode", () => {
    const long = "x".repeat(REPLY_PREVIEW_LIMIT + 50);
    const body = encodeReplyBody("hi", { id: "p1", sender: "bob", preview: long });
    const parsed = decodeBody(body);
    expect(parsed.reply?.preview).toHaveLength(REPLY_PREVIEW_LIMIT);
    expect(parsed.reply?.preview).toBe(long.slice(0, REPLY_PREVIEW_LIMIT));
  });

  it("truncatePreview slices long text and passes short text through", () => {
    expect(truncatePreview("abc")).toBe("abc");
    expect(truncatePreview("x".repeat(REPLY_PREVIEW_LIMIT + 1))).toHaveLength(REPLY_PREVIEW_LIMIT);
  });

  it("decodeBody falls back to plain text for non-JSON input", () => {
    expect(decodeBody("just a message")).toEqual({ text: "just a message", reply: null });
  });

  it("decodeBody falls back for JSON that is not a v1 envelope", () => {
    expect(decodeBody('{"foo":1}')).toEqual({ text: '{"foo":1}', reply: null });
    expect(decodeBody('{"v":1,"text":123,"reply":{}}')).toEqual({
      text: '{"v":1,"text":123,"reply":{}}',
      reply: null,
    });
    expect(decodeBody('{"v":2,"text":"hi"}')).toEqual({
      text: '{"v":2,"text":"hi"}',
      reply: null,
    });
    expect(decodeBody("123")).toEqual({ text: "123", reply: null });
    expect(decodeBody("")).toEqual({ text: "", reply: null });
  });

  it("decodeBody unwraps a v1 envelope without a reply key, falls back on malformed reply", () => {
    expect(decodeBody('{"v":1,"text":"plain"}')).toEqual({ text: "plain", reply: null });
    const bad = '{"v":1,"text":"hi","reply":{"id":1}}';
    expect(decodeBody(bad)).toEqual({ text: bad, reply: null });
  });

  it("decodeBody never throws, even on garbage", () => {
    expect(() => decodeBody("{not json")).not.toThrow();
    expect(() => decodeBody("")).not.toThrow();
  });
});

describe("buildSendBody", () => {
  it("returns raw text when reply is null", () => {
    expect(buildSendBody("hello", null)).toBe("hello");
  });

  it("returns a parseable envelope carrying the reply ref when reply is set", () => {
    const body = buildSendBody("answer", { id: "p1", sender: "bob", preview: "quoted" });
    expect(body).not.toBe("answer");
    const parsed = decodeBody(body);
    expect(parsed.text).toBe("answer");
    expect(parsed.reply).toEqual({ id: "p1", sender: "bob", preview: "quoted" });
  });
});

describe("resolveReplyRef", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    previewStub.map.clear();
    vi.clearAllMocks();
  });

  it("resolves sender from the parent row; preview falls back to '' when undecrypted", () => {
    seedCache(client, "private", "chat-1", [makeServerRow()]);
    // No decrypted entry seeded → getDecrypted returns undefined.
    expect(getDecrypted("parent-1")).toBeUndefined();
    const ref = resolveReplyRef(client, "private", "chat-1", "parent-1");
    expect(ref).toEqual({ id: "parent-1", sender: "user-bob", preview: "" });
  });

  it("falls back to sender 'unknown' when the parent row is not in cache", () => {
    seedCache(client, "private", "chat-1", [makeServerRow({ id: "other" })]);
    const ref = resolveReplyRef(client, "private", "chat-1", "missing-parent");
    expect(ref).toEqual({ id: "missing-parent", sender: "unknown", preview: "" });
  });

  it("resolves the preview from the decryption cache when the parent is decrypted", () => {
    seedCache(client, "private", "chat-1", [makeServerRow()]);
    previewStub.map.set("parent-1", "parent decrypted text");
    expect(getDecrypted("parent-1")?.text).toBe("parent decrypted text");
    const ref = resolveReplyRef(client, "private", "chat-1", "parent-1");
    expect(ref).toEqual({ id: "parent-1", sender: "user-bob", preview: "parent decrypted text" });
    // The resolved ref feeds the envelope: encrypt input carries both text and reply.
    const body = buildSendBody("my answer", ref);
    const parsed = decodeBody(body);
    expect(parsed.text).toBe("my answer");
    expect(parsed.reply).toEqual(ref);
  });

  it("throws when the parent is a pending optimistic row", () => {
    const pending = makePendingRow();
    expect(isPendingMessage(pending)).toBe(true);
    seedCache(client, "private", "chat-1", [pending]);
    expect(() => resolveReplyRef(client, "private", "chat-1", pending.id)).toThrow(
      "Cannot reply to an unsent message",
    );
  });

  it("throws when the parent is a failed optimistic row", () => {
    const failed = makePendingRow({ status: "failed" });
    seedCache(client, "group", "g1", [failed]);
    expect(() => resolveReplyRef(client, "group", "g1", failed.id)).toThrow(
      "Cannot reply to an unsent message",
    );
  });
});
