import { useQuery } from "@tanstack/react-query";
import { Stack } from "@mantine/core";

import { listGroupMedia, listPrivateMedia } from "@/features/media/api";
import { MediaPreview } from "@/features/media/components/MediaPreview";

/**
 * Attachments of a sent message, rendered under its text bubble.
 *
 * Lists the message's media via the kind-matched endpoint and renders
 * one {@link MediaPreview} per attachment (images inline on click,
 * other files as download cards). Loading / error / empty states
 * render nothing — attachments are progressive enhancement, they must
 * never break or shift the message list.
 */
export function MessageAttachments({
  messageId,
  kind = "private",
}: {
  messageId: string;
  kind?: "private" | "group";
}): JSX.Element | null {
  const { data } = useQuery({
    queryKey: ["message-media", kind, messageId],
    queryFn: () => (kind === "private" ? listPrivateMedia(messageId) : listGroupMedia(messageId)),
    // Attachments of a sent message are immutable (linked at send).
    staleTime: Infinity,
    retry: 1,
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <Stack gap={4}>
      {items.map((att) => (
        <MediaPreview key={att.id} attachment={att} kind={kind} />
      ))}
    </Stack>
  );
}
