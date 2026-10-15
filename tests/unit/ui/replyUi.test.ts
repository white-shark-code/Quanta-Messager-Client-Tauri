import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  jumpToMessage,
  MESSAGE_HIGHLIGHT_EVENT,
  openThread,
  THREAD_OPEN_EVENT,
} from "@/features/messages/jumpToMessage";
import type { DialogMessage } from "@/features/messages/model";
import type { PendingMessage } from "@/features/messages/mutations";
import { buildReplyCounts } from "@/features/messages/useReplyCounts";

interface StubDecrypted {
  text: string;
  verified: boolean;
  reply: { id: string; sender: string; preview: string } | null;
}

const decryptStub = vi.hoisted(() => ({ map: new Map<string, StubDecrypted>() }));

vi.mock("@/features/messages/queries", () => ({
  getDecrypted: (id: string) => decryptStub.map.get(id),
}));

function dialog(id: string): DialogMessage {
  return {
    id,
    chat_id: "c1",
    owner_id: "user-1",
    encrypted_message: "ZW5jcnlwdGVk",
    signature: "c2ln",
    creation_datetime: "2026-09-08T00:00:00Z",
  };
}

function pending(id: string, replyPreview?: PendingMessage["replyPreview"]): PendingMessage {
  return {
    ...dialog(id),
    id: `optimistic-${id}`,
    status: "pending",
    text: "optimistic text",
    createdAt: 1_690_000_000_000,
    optimistic: true,
    ...(replyPreview !== undefined ? { replyPreview } : {}),
  };
}

describe("messages/useReplyCounts.buildReplyCounts", () => {
  beforeEach(() => {
    decryptStub.map.clear();
  });

  it("counts decrypted replies per parent id", () => {
    decryptStub.map.set("m2", {
      text: "reply one",
      verified: true,
      reply: { id: "m1", sender: "user-2", preview: "parent" },
    });
    decryptStub.map.set("m3", {
      text: "reply two",
      verified: true,
      reply: { id: "m1", sender: "user-2", preview: "parent" },
    });
    decryptStub.map.set("m4", { text: "plain", verified: true, reply: null });

    expect(buildReplyCounts([dialog("m1"), dialog("m2"), dialog("m3"), dialog("m4")])).toEqual({
      m1: 2,
    });
  });

  it("counts optimistic rows via replyPreview without decryption", () => {
    const optimistic = pending("new", { id: "m1", sender: "user-1", preview: "parent" });

    expect(buildReplyCounts([dialog("m1"), optimistic])).toEqual({ m1: 1 });
  });

  it("ignores plain messages, undecrypted rows and preview-less optimistic rows", () => {
    decryptStub.map.set("m2", { text: "plain", verified: true, reply: null });

    expect(buildReplyCounts([dialog("m1"), dialog("m2"), pending("new")])).toEqual({});
  });
});

describe("messages/jumpToMessage", () => {
  const dispatched: Event[] = [];
  const scrolled: { id: string; opts: unknown }[] = [];

  beforeEach(() => {
    dispatched.length = 0;
    scrolled.length = 0;
    vi.stubGlobal("window", {
      dispatchEvent: (e: Event) => {
        dispatched.push(e);
        return true;
      },
    });
    vi.stubGlobal("document", {
      getElementById: (id: string) => ({
        scrollIntoView: (opts: unknown) => {
          scrolled.push({ id, opts });
        },
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scrolls to the msg-<id> anchor and emits the highlight event", () => {
    jumpToMessage("parent-1");

    expect(scrolled).toEqual([
      { id: "msg-parent-1", opts: { behavior: "smooth", block: "center" } },
    ]);
    expect(dispatched).toHaveLength(1);
    const event = dispatched[0] as CustomEvent<{ messageId: string }>;
    expect(event.type).toBe(MESSAGE_HIGHLIGHT_EVENT);
    expect(event.detail).toEqual({ messageId: "parent-1" });
  });

  it("openThread dispatches thread:open with the messageId detail ChatRoute listens for", () => {
    openThread("m1");

    expect(dispatched).toHaveLength(1);
    const event = dispatched[0] as CustomEvent<{ messageId: string }>;
    expect(event.type).toBe(THREAD_OPEN_EVENT);
    expect(event.detail).toEqual({ messageId: "m1" });
  });
});
