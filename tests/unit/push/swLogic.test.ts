import { describe, expect, it } from "vitest";

import {
  isKnownPushType,
  notificationForPayload,
  shouldShowNotification,
} from "@/features/push/swLogic";

describe("push/swLogic — isKnownPushType", () => {
  it("accepts new_dialog_message and new_group_message", () => {
    expect(isKnownPushType("new_dialog_message")).toBe(true);
    expect(isKnownPushType("new_group_message")).toBe(true);
  });

  it("rejects unknown, empty and non-string types", () => {
    expect(isKnownPushType("pong")).toBe(false);
    expect(isKnownPushType("connected")).toBe(false);
    expect(isKnownPushType("")).toBe(false);
    expect(isKnownPushType(undefined)).toBe(false);
    expect(isKnownPushType(null)).toBe(false);
    expect(isKnownPushType(42)).toBe(false);
  });
});

describe("push/swLogic — notificationForPayload", () => {
  it("builds a generic notification for a dialog message", () => {
    expect(
      notificationForPayload({
        type: "new_dialog_message",
        chat_id: "chat-1",
        message_id: "msg-1",
      }),
    ).toEqual({
      title: "Quant",
      body: "Новое сообщение",
      tag: "msg-1",
      data: { chat_id: "chat-1", url: "/chats/chat-1" },
    });
  });

  it("builds a generic notification for a group message", () => {
    expect(
      notificationForPayload({
        type: "new_group_message",
        chat_id: "group-7",
        message_id: "msg-9",
      }),
    ).toEqual({
      title: "Quant",
      body: "Новое сообщение",
      tag: "msg-9",
      data: { chat_id: "group-7", url: "/chats/group-7" },
    });
  });

  it("never leaks names or ciphertext into the notification", () => {
    const notification = notificationForPayload({
      type: "new_dialog_message",
      chat_id: "chat-1",
      message_id: "msg-1",
      sender_name: "Alice",
      text: "secret",
    });
    expect(JSON.stringify(notification)).not.toContain("Alice");
    expect(JSON.stringify(notification)).not.toContain("secret");
  });

  it("returns null for unknown push types", () => {
    expect(notificationForPayload({ type: "pong", chat_id: "c", message_id: "m" })).toBeNull();
    expect(notificationForPayload({ type: "connected", chat_id: "c", message_id: "m" })).toBeNull();
    expect(notificationForPayload({ chat_id: "c", message_id: "m" })).toBeNull();
  });

  it("returns null for missing chat_id / message_id", () => {
    expect(notificationForPayload({ type: "new_dialog_message" })).toBeNull();
    expect(notificationForPayload({ type: "new_dialog_message", chat_id: "c" })).toBeNull();
    expect(notificationForPayload({ type: "new_group_message", message_id: "m" })).toBeNull();
    expect(
      notificationForPayload({ type: "new_dialog_message", chat_id: "", message_id: "m" }),
    ).toBeNull();
  });

  it("returns null for non-object payloads (garbage push data)", () => {
    expect(notificationForPayload(null)).toBeNull();
    expect(notificationForPayload(undefined)).toBeNull();
    expect(notificationForPayload("text")).toBeNull();
    expect(notificationForPayload(42)).toBeNull();
    expect(notificationForPayload([])).toBeNull();
  });
});

describe("push/swLogic — shouldShowNotification", () => {
  it("shows when there are no clients at all", () => {
    expect(shouldShowNotification([])).toBe(true);
  });

  it("shows when all clients are hidden", () => {
    expect(
      shouldShowNotification([{ visibilityState: "hidden" }, { visibilityState: "hidden" }]),
    ).toBe(true);
  });

  it("hides when any client is visible (live UI renders via useEventsSocket)", () => {
    expect(shouldShowNotification([{ visibilityState: "visible" }])).toBe(false);
    expect(
      shouldShowNotification([{ visibilityState: "hidden" }, { visibilityState: "visible" }]),
    ).toBe(false);
  });
});
