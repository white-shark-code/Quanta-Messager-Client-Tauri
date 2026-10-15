import { describe, expect, it } from "vitest";

import { buildThread, THREAD_MAX_DEPTH, type ThreadItem } from "@/features/messages/thread";
import type { ReplyRef } from "@/features/messages/replyEnvelope";

function ref(id: string): ReplyRef {
  return { id, sender: `sender-of-${id}`, preview: `preview-of-${id}` };
}

function item(id: string, parentId: string | null): ThreadItem {
  return { id, reply: parentId === null ? null : ref(parentId) };
}

describe("messages/thread buildThread", () => {
  it("orders a linear chain root → target", () => {
    const items = [item("a", null), item("b", "a"), item("c", "b")];
    expect(buildThread(items, "c")).toEqual([
      { id: "a", missing: false },
      { id: "b", missing: false },
      { id: "c", missing: false },
    ]);
  });

  it("returns a middle node with its ancestors only", () => {
    const items = [item("a", null), item("b", "a"), item("c", "b")];
    expect(buildThread(items, "b")).toEqual([
      { id: "a", missing: false },
      { id: "b", missing: false },
    ]);
  });

  it("returns a single node for a target with no reply", () => {
    expect(buildThread([item("a", null)], "a")).toEqual([{ id: "a", missing: false }]);
  });

  it("appends a missing node and stops when the parent is not loaded", () => {
    const items = [item("b", "a"), item("c", "b")];
    expect(buildThread(items, "c")).toEqual([
      { id: "a", missing: true },
      { id: "b", missing: false },
      { id: "c", missing: false },
    ]);
  });

  it("stops at a missing parent mid-chain without including phantom ancestors", () => {
    // a → MISSING → b → c, only b and c loaded.
    const items = [item("b", "ghost"), item("c", "b")];
    const chain = buildThread(items, "c");
    expect(chain).toEqual([
      { id: "ghost", missing: true },
      { id: "b", missing: false },
      { id: "c", missing: false },
    ]);
  });

  it("returns a single missing node when the target itself is unknown", () => {
    expect(buildThread([item("a", null)], "nope")).toEqual([{ id: "nope", missing: true }]);
  });

  it("guards against a two-node cycle", () => {
    const items = [item("a", "b"), item("b", "a")];
    const chain = buildThread(items, "b");
    // b → a → (b already visited, stop). Root-first: a, b.
    expect(chain).toEqual([
      { id: "a", missing: false },
      { id: "b", missing: false },
    ]);
  });

  it("guards against a self-reply cycle", () => {
    expect(buildThread([item("a", "a")], "a")).toEqual([{ id: "a", missing: false }]);
  });

  it("caps the walk at THREAD_MAX_DEPTH ancestors", () => {
    const items: ThreadItem[] = [];
    const n = THREAD_MAX_DEPTH + 10;
    for (let i = 0; i < n; i++) {
      items.push(item(`m${i}`, i === 0 ? null : `m${i - 1}`));
    }
    const chain = buildThread(items, `m${n - 1}`);
    expect(chain.length).toBe(THREAD_MAX_DEPTH + 1);
    expect(chain[chain.length - 1]).toEqual({ id: `m${n - 1}`, missing: false });
    // Oldest resolved node is the truncation head, not the true root.
    expect(chain[0]).toEqual({ id: `m${n - 1 - THREAD_MAX_DEPTH}`, missing: false });
    expect(chain.every((node) => !node.missing)).toBe(true);
  });
});
