import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useReplyStore } from "@/features/messages/replyStore";

describe("messages/replyStore", () => {
  beforeEach(() => {
    useReplyStore.setState({ replies: {} });
  });

  afterEach(() => {
    useReplyStore.setState({ replies: {} });
  });

  it("starts empty", () => {
    expect(useReplyStore.getState().replies).toEqual({});
  });

  it("sets a reply for a chat", () => {
    useReplyStore.getState().setReply("chat-1", { id: "m1", sender: "a", preview: "hi" });

    expect(useReplyStore.getState().replies["chat-1"]).toEqual({
      id: "m1",
      sender: "a",
      preview: "hi",
    });
  });

  it("clears a reply for a chat", () => {
    useReplyStore.getState().setReply("chat-1", { id: "m1", sender: "a", preview: "hi" });
    useReplyStore.getState().clearReply("chat-1");

    expect(useReplyStore.getState().replies["chat-1"]).toBeUndefined();
  });

  it("isolates replies per chat", () => {
    useReplyStore.getState().setReply("chat-1", { id: "m1", sender: "a", preview: "one" });
    useReplyStore.getState().setReply("chat-2", { id: "m2", sender: "b", preview: "two" });

    useReplyStore.getState().clearReply("chat-1");

    expect(useReplyStore.getState().replies["chat-1"]).toBeUndefined();
    expect(useReplyStore.getState().replies["chat-2"]).toEqual({
      id: "m2",
      sender: "b",
      preview: "two",
    });
  });

  it("overwrites the previous reply for the same chat", () => {
    useReplyStore.getState().setReply("chat-1", { id: "m1", sender: "a", preview: "one" });
    useReplyStore.getState().setReply("chat-1", { id: "m2", sender: "b", preview: "two" });

    expect(useReplyStore.getState().replies["chat-1"]?.id).toBe("m2");
  });

  it("clearReply is a no-op for unknown chats", () => {
    useReplyStore.getState().setReply("chat-1", { id: "m1", sender: "a", preview: "one" });
    useReplyStore.getState().clearReply("chat-unknown");

    expect(useReplyStore.getState().replies["chat-1"]?.id).toBe("m1");
  });
});
