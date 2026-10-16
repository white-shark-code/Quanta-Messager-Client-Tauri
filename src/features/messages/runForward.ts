import type { QueryClient } from "@tanstack/react-query";

import { forwardMessages, type ForwardResult } from "./forward";
import type { ForwardTarget } from "./forwardStore";
import type { ChatKind } from "./mutations";

export interface RunForwardArgs {
  queryClient: QueryClient;
  sourceChatId: string;
  sourceKind: ChatKind;
  targetChatId: string;
  /** Accepts `"group"` for forward-compat; the picker lists private chats only. */
  targetKind: ChatKind;
  targetPeerKeyArmored: string | null;
  messageIds: string[];
  setTarget: (t: ForwardTarget) => void;
  /** Injectable transport; defaults to {@link forwardMessages}. */
  send?: typeof forwardMessages;
}

/**
 * Record the picked target, then forward. Callers interpret the result:
 * `sent.length === 0` → stay open with an error; `skipped.length > 0`
 * with sent items → warn inline but still navigate. Rejects on send
 * failure (caller shows an inline error and stays open).
 */
export async function runForwardToTarget(args: RunForwardArgs): Promise<ForwardResult> {
  const send = args.send ?? forwardMessages;
  args.setTarget({ chatId: args.targetChatId, kind: args.targetKind });
  return send({
    queryClient: args.queryClient,
    sourceChatId: args.sourceChatId,
    sourceKind: args.sourceKind,
    targetChatId: args.targetChatId,
    targetKind: args.targetKind,
    targetPeerKeyArmored: args.targetPeerKeyArmored,
    messageIds: args.messageIds,
  });
}
