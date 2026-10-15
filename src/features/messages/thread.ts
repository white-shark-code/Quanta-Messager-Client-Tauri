/**
 * Reply-thread chain builder (reply feature, stage 2 — thread view).
 *
 * Pure function, no React imports — heavily unit-tested in
 * `tests/unit/messages/thread.test.ts`.
 *
 * Contract (shared with parallel tracks):
 * - `ReplyRef { id: string; sender: string; preview: string }` lives in
 *   `src/features/messages/replyEnvelope.ts`.
 * - Each message's reply link is readable via
 *   `getDecrypted(messageId)?.reply` (`src/features/messages/queries.ts`).
 *   The caller (React side, `ThreadPanel`) flattens the chat's messages
 *   into {@link ThreadItem} rows and hands them here.
 */

import type { ReplyRef } from "./replyEnvelope";

/** One flat chat message, reduced to its id + parent link. */
export interface ThreadItem {
  id: string;
  reply: ReplyRef | null;
}

/** One node of the resolved thread chain, ordered root → … → target. */
export interface ThreadNode {
  id: string;
  /** True for a synthetic node whose message isn't in the loaded list. */
  missing: boolean;
}

/**
 * Maximum ancestors followed from the target. Bounds the walk for
 * pathological chains; a chain longer than this is truncated at the root
 * side (the oldest resolved node is simply the chain head).
 */
export const THREAD_MAX_DEPTH = 50;

/**
 * Build the reply chain ending at `targetId`, ordered root → … → target.
 *
 * Walks parent links starting from the target, prepending each parent.
 * Stops at a root (`reply === null`), a missing parent (appends a
 * synthetic `{ id: parentId, missing: true }` node, then stops), a cycle
 * (visited-set guard), or {@link THREAD_MAX_DEPTH} ancestors.
 *
 * Display text is NOT resolved here — the caller renders each node via
 * `getDecrypted` / `useDecryptedMessage`; a `missing` node renders the
 * `messages.originalUnavailable` placeholder.
 *
 * @returns Root-first chain. If `targetId` itself isn't in `items`, a
 * single synthetic missing node is returned so the UI can show the
 * placeholder instead of an empty panel.
 */
export function buildThread(items: ThreadItem[], targetId: string): ThreadNode[] {
  const byId = new Map<string, ThreadItem>();
  for (const item of items) {
    byId.set(item.id, item);
  }

  const target = byId.get(targetId);
  if (target === undefined) {
    return [{ id: targetId, missing: true }];
  }

  // Walk target → root, collecting reversed (target-first)…
  const reversed: ThreadNode[] = [{ id: target.id, missing: false }];
  const visited = new Set<string>([target.id]);
  let current = target;
  for (let depth = 0; depth < THREAD_MAX_DEPTH; depth++) {
    if (current.reply === null) break;
    const parentId = current.reply.id;
    if (visited.has(parentId)) break; // cycle (incl. self-reply)
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) {
      reversed.push({ id: parentId, missing: true });
      break;
    }
    reversed.push({ id: parent.id, missing: false });
    current = parent;
  }

  // …then flip to root-first.
  reversed.reverse();
  return reversed;
}
