import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEventsPolling } from "./polling";
import { markDialogRead, markGroupRead } from "./api";

export function useMarkAsRead(chatId: string, kind: "private" | "group" = "private") {
  const queryClient = useQueryClient();
  const { data: events } = useEventsPolling();
  const markedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!events) return;
    const matching = kind === "private" ? events.dialog : events.group;
    const evt = matching.find((e) => e.chat_id === chatId && e.count > 0);
    if (!evt) return;
    if (markedRef.current.has(evt.id)) return;

    markedRef.current.add(evt.id);

    queryClient.setQueryData(["events"], (old: typeof events) => {
      if (!old) return old;
      return {
        dialog: old.dialog.map((e) => (e.id === evt.id ? { ...e, count: 0 } : e)),
        group: old.group.map((e) => (e.id === evt.id ? { ...e, count: 0 } : e)),
      };
    });

    const mark = kind === "private" ? markDialogRead : markGroupRead;
    mark(evt.id).catch(() => {
      markedRef.current.delete(evt.id);
    });
  }, [chatId, kind, events, queryClient]);
}
