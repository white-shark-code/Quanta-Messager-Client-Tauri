/**
 * Shared scroll/navigation helpers for reply quotes (Track C).
 *
 * Track D's `ThreadPanel` keeps a local copy of `jumpToMessage` with a
 * NOTE to adopt this module — prefer importing from here.
 */

/** DOM id of a `MessageBubble` wrapper — quote clicks scroll to `msg-<id>`. */
export function messageAnchorId(messageId: string): string {
  return `msg-${messageId}`;
}

/** Window event that flash-highlights a bubble (detail: `{ messageId }`). */
export const MESSAGE_HIGHLIGHT_EVENT = "message:highlight";

/** Window event that opens the thread panel (detail: `{ messageId }`). */
export const THREAD_OPEN_EVENT = "thread:open";

function dispatchDetail(eventName: string, messageId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ messageId: string }>(eventName, { detail: { messageId } }),
  );
}

/**
 * Scroll the chat list to a message anchor and ask its bubble to
 * flash-highlight (each `MessageBubble` listens for
 * {@link MESSAGE_HIGHLIGHT_EVENT} for its own id). No-ops outside a DOM
 * environment (unit tests).
 */
export function jumpToMessage(messageId: string): void {
  if (typeof document !== "undefined") {
    document
      .getElementById(messageAnchorId(messageId))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  dispatchDetail(MESSAGE_HIGHLIGHT_EVENT, messageId);
}

/**
 * Ask the route to open the thread panel for `messageId` (the route
 * listens for {@link THREAD_OPEN_EVENT}). No-ops outside a DOM
 * environment.
 */
export function openThread(messageId: string): void {
  dispatchDetail(THREAD_OPEN_EVENT, messageId);
}
