/**
 * Unified auto-scroll for chat-like lists.
 *
 * Policy (single place for the whole app):
 *
 * - **Stick to bottom** — appended messages (new arrivals, own sends)
 *   scroll the list down only when the user was already near the bottom.
 *   Reading history is never interrupted.
 * - **Preserve position on prepend** — loading earlier messages keeps the
 *   viewport offset stable (`scrollHeight - scrollTop` invariant) instead
 *   of jumping to the bottom.
 * - **Jump to id** — reply-quote / thread jumps route through the same
 *   module (`jumpToId`, backed by the shared message-anchor helper).
 *
 * Usage:
 *
 * ```tsx
 * const scroll = useChatScroll({ resetKey: chatId, itemCount: items.length });
 * <div ref={scroll.containerRef} onScroll={scroll.onScroll} style={{ overflowY: "auto" }}>
 *   ...
 *   <div ref={scroll.bottomAnchorRef} />
 * </div>
 * // Load earlier (no jump to bottom):
 * <button onClick={() => { scroll.beginPrepend(); void fetchNextPage(); }}>
 * ```
 *
 * When `itemCount` is provided the hook auto-tracks growth: a pending
 * `beginPrepend()` snapshot restores the offset, otherwise appended items
 * stick only if the list was near the bottom. Without `itemCount`, call
 * `maybeStickToBottom()` manually after renders.
 *
 * Extending to other lists: pass a different `thresholdPx` / `smooth`,
 * compose the returned callbacks, or reuse the pure helpers
 * (`isNearBottomDims`, `restoreScrollTopAfterPrepend`) in a custom hook —
 * the scroll math lives outside React so it stays testable.
 */

import { useCallback, useEffect, useRef, type RefObject } from "react";

import { jumpToMessage } from "@/features/messages/jumpToMessage";

/** Default "user is at the bottom" tolerance. */
export const NEAR_BOTTOM_THRESHOLD_PX = 80;

/** Viewport snapshot taken before earlier messages are prepended. */
export interface ScrollSnapshot {
  scrollHeight: number;
  scrollTop: number;
  itemCount: number;
}

/**
 * Pure check: is `scrollTop` within `thresholdPx` of the container bottom?
 * Exported for tests and for custom hooks composing their own policy.
 */
export function isNearBottomDims(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= thresholdPx;
}

/**
 * Pure math: the `scrollTop` that keeps the user's viewport stable after
 * `nextScrollHeight - prev.scrollHeight` pixels were prepended above.
 * Exported for tests and reuse.
 */
export function restoreScrollTopAfterPrepend(
  prev: Pick<ScrollSnapshot, "scrollHeight" | "scrollTop">,
  nextScrollHeight: number,
): number {
  return nextScrollHeight - prev.scrollHeight + prev.scrollTop;
}

export interface UseChatScrollOptions {
  /**
   * Identity of the current list (e.g. `chatId`). Changing it resets the
   * stick flag, the pending prepend snapshot and the item counter so the
   * next paint jumps straight to the bottom.
   */
  resetKey?: string | undefined;
  /**
   * Current rendered item count. When provided, the hook automatically
   * restores the offset on prepend-loads and sticks to the bottom on
   * appends (only if the user was near the bottom).
   */
  itemCount?: number;
  /** Near-bottom tolerance in px. Defaults to {@link NEAR_BOTTOM_THRESHOLD_PX}. */
  thresholdPx?: number;
  /** Animate programmatic scrolls. Defaults to `true`. */
  smooth?: boolean;
}

export interface UseChatScrollReturn {
  /** Attach to the scrollable list container. */
  containerRef: RefObject<HTMLDivElement>;
  /** Bottom anchor (render an empty div with it at the list end). */
  bottomAnchorRef: RefObject<HTMLDivElement>;
  /** Attach to the container's `onScroll` — tracks near-bottom state. */
  onScroll: () => void;
  /** Whether the container is currently within `thresholdPx` of the bottom. */
  isNearBottom: (thresholdPx?: number) => boolean;
  /** Scroll the container to the bottom. */
  scrollToBottom: (smooth?: boolean) => void;
  /** Scroll to the bottom only if the user was already near it. */
  maybeStickToBottom: (smooth?: boolean) => void;
  /**
   * Snapshot the viewport before prepending earlier messages (call right
   * before `fetchNextPage()`); the offset is restored once `itemCount`
   * grows. No-op without a mounted container.
   */
  beginPrepend: () => void;
  /** Scroll to a message anchor + flash-highlight it (reply/thread jumps). */
  jumpToId: (messageId: string) => void;
}

export function useChatScroll(options: UseChatScrollOptions = {}): UseChatScrollReturn {
  const { resetKey, itemCount, thresholdPx = NEAR_BOTTOM_THRESHOLD_PX, smooth = true } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const snapRef = useRef<ScrollSnapshot | null>(null);
  const prevCountRef = useRef(0);

  // Switching lists (e.g. another chat) resets the policy state; the
  // `itemCount` effect below then jumps straight to the bottom.
  useEffect(() => {
    stickRef.current = true;
    snapRef.current = null;
    prevCountRef.current = 0;
  }, [resetKey]);

  const isNearBottom = useCallback(
    (overridePx?: number): boolean => {
      const el = containerRef.current;
      if (el === null) return true;
      return isNearBottomDims(
        el.scrollHeight,
        el.scrollTop,
        el.clientHeight,
        overridePx ?? thresholdPx,
      );
    },
    [thresholdPx],
  );

  const onScroll = useCallback((): void => {
    stickRef.current = isNearBottom();
  }, [isNearBottom]);

  const scrollToBottom = useCallback(
    (smoothArg?: boolean): void => {
      const el = containerRef.current;
      if (el === null) return;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: (smoothArg ?? smooth) ? "smooth" : "auto",
      });
    },
    [smooth],
  );

  const maybeStickToBottom = useCallback(
    (smoothArg?: boolean): void => {
      if (stickRef.current) scrollToBottom(smoothArg);
    },
    [scrollToBottom],
  );

  const beginPrepend = useCallback((): void => {
    const el = containerRef.current;
    if (el === null) return;
    snapRef.current = {
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      itemCount: prevCountRef.current,
    };
  }, []);

  const jumpToId = useCallback((messageId: string): void => {
    jumpToMessage(messageId);
  }, []);

  // Auto-track list growth: prepend-loads restore the viewport offset,
  // appended messages stick only when the user was near the bottom,
  // first paint (or list reset) jumps straight to the bottom.
  useEffect(() => {
    if (itemCount === undefined) return;
    const prev = prevCountRef.current;
    prevCountRef.current = itemCount;
    const el = containerRef.current;
    if (itemCount === 0 || el === null) return;
    const snap = snapRef.current;
    snapRef.current = null;
    if (snap !== null && itemCount > snap.itemCount) {
      el.scrollTop = restoreScrollTopAfterPrepend(snap, el.scrollHeight);
      return;
    }
    if (prev === 0) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (itemCount > prev) {
      maybeStickToBottom();
    } else if (itemCount < prev) {
      el.scrollTop = el.scrollHeight;
    }
  }, [itemCount, maybeStickToBottom]);

  return {
    containerRef,
    bottomAnchorRef,
    onScroll,
    isNearBottom,
    scrollToBottom,
    maybeStickToBottom,
    beginPrepend,
    jumpToId,
  };
}
