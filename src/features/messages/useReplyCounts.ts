import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { DialogMessage } from "./model";
import { isPendingMessage } from "./mutations";
import { getDecrypted } from "./queries";

/**
 * Count replies per parent message id.
 *
 * Pure (no React) so it is cheap to unit-test: for confirmed rows the
 * parent link is peeked from the decryption cache (`getDecrypted(id)?.reply`
 * — non-reactive, fine for a badge that recomputes when the list or any
 * decrypt query settles); for optimistic rows it comes from
 * `PendingMessage.replyPreview`. Exported for tests.
 */
export function buildReplyCounts(messages: DialogMessage[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    const parentId = isPendingMessage(message)
      ? (message.replyPreview?.id ?? null)
      : (getDecrypted(message.id)?.reply?.id ?? null);
    if (parentId === null) continue;
    counts[parentId] = (counts[parentId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Reactive reply-count map for a message list, computed once per list
 * (not per bubble — scanning inside every `MessageBubble` would be
 * wasteful). Recomputes when the list identity changes and whenever any
 * `message-decrypt` query settles (a newly decrypted reply must light up
 * its parent's badge even though the list itself didn't change).
 */
export function useReplyCounts(messages: DialogMessage[] | undefined): Record<string, number> {
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      // React ONLY to a decrypt fetch settling into success. Every other
      // cache event (fetch-start, observer attach, error, another query's
      // updates) must be ignored: bumping state on those re-renders the
      // chat, which re-emits observer events, which bumps state again —
      // an infinite render loop (caught by E2E: "Maximum update depth"
      // ×200 in MessageBubble/ChatRoute). A success fires once per query
      // (staleTime: Infinity), so this terminates.
      if (event.type !== "updated") return;
      if (event.action.type !== "success") return;
      const queryKey = event.query.queryKey as readonly unknown[];
      if (queryKey[0] === "message-decrypt") {
        setVersion((v) => v + 1);
      }
    });
    return unsubscribe;
  }, [queryClient]);

  // `version` is intentionally a dependency: decrypt settlements don't
  // change `messages` but do change what `getDecrypted` peeks return.
  return useMemo(
    () => buildReplyCounts(messages ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, version],
  );
}
