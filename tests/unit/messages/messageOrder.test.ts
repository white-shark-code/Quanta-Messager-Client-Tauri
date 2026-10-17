import { describe, expect, it } from "vitest";

import type { DialogMessage } from "@/features/messages/model";
import {
  insertPending,
  replacePending,
  type MessagesCache,
  type PendingMessage,
} from "@/features/messages/mutations";
import { compareByCreationDate } from "@/features/messages/queries";

function serverMessage(id: string, creation_datetime: string): DialogMessage {
  return {
    id,
    chat_id: "c1",
    owner_id: "user-1",
    encrypted_message: "ZW5jcnlwdGVk",
    signature: "c2ln",
    creation_datetime,
  };
}

function pendingMessage(id: string, creation_datetime: string): PendingMessage {
  return {
    ...serverMessage(id, creation_datetime),
    status: "pending",
    text: "hello",
    createdAt: Date.parse(creation_datetime),
    optimistic: true,
  };
}

function cacheOf(...pages: DialogMessage[][]): MessagesCache {
  return {
    pages: pages.map((items) => ({ items })),
    pageParams: pages.map((_, i) => i),
  };
}

/** Mirror of the `select` in queries.ts: flatten + chronological sort. */
function visibleItems(cache: MessagesCache): DialogMessage[] {
  return cache.pages.flatMap((p) => p.items).sort(compareByCreationDate);
}

const T1 = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-01T10:01:00.000Z";
const T3 = "2026-10-01T10:02:00.000Z";
const T4 = "2026-10-01T10:03:00.000Z";

describe("message order: optimistic insert + reconcile (Task 2)", () => {
  it("insertPending appends to the tail of the last page, head untouched", () => {
    const cache = cacheOf(
      [serverMessage("m1", T1), serverMessage("m2", T2)],
      [serverMessage("m3", T3)],
    );
    const next = insertPending(cache, pendingMessage("opt-1", T4));

    expect(next.pages).toHaveLength(2);
    expect(next.pages[0]?.items.map((m) => m.id)).toEqual(["m1", "m2"]);
    const last = next.pages[next.pages.length - 1]?.items ?? [];
    expect(last[last.length - 1]?.id).toBe("opt-1");
  });

  it("pending renders at the bottom after the chronological select", () => {
    const cache = cacheOf([serverMessage("m1", T1)], [serverMessage("m2", T2)]);
    const next = insertPending(cache, pendingMessage("opt-1", T4));

    const items = visibleItems(next);
    expect(items[items.length - 1]?.id).toBe("opt-1");
  });

  it("replacePending keeps the server row at the bottom (no jump after refetch)", () => {
    const cache = cacheOf([serverMessage("m1", T1)], [serverMessage("m2", T2)]);
    const withPending = insertPending(cache, pendingMessage("opt-1", T4));

    const replaced = replacePending(withPending, "opt-1", serverMessage("srv-1", T4));
    const items = visibleItems(replaced);

    expect(items.find((m) => m.id === "opt-1")).toBeUndefined();
    expect(items[items.length - 1]?.id).toBe("srv-1");
    expect(items.map((m) => m.id)).toEqual(["m1", "m2", "srv-1"]);
  });

  it("insertPending on an empty cache creates a single page", () => {
    const next = insertPending({ pages: [], pageParams: [] }, pendingMessage("opt-1", T4));
    expect(next.pages).toHaveLength(1);
    expect(next.pages[0]?.items.map((m) => m.id)).toEqual(["opt-1"]);
  });
});
