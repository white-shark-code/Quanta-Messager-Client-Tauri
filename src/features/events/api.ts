import { apiClient } from "@/infra/apiClient";
import type { DialogEvent, GroupEvent, ListItems } from "./model";

export async function getDialogEvents(): Promise<ListItems<DialogEvent>> {
  return apiClient.get<ListItems<DialogEvent>>("/event/dialogs/");
}

export async function getGroupEvents(): Promise<ListItems<GroupEvent>> {
  return apiClient.get<ListItems<GroupEvent>>("/event/groups/");
}

/**
 * NOTE: backend returns HTML 200 with an empty body, not JSON.
 * `apiClient` currently falls through to `response.text()` for non-JSON
 * Content-Type and casts the result to `void` — this happens to work
 * because the empty string is ignored, but it is fragile. A follow-up
 * should teach `apiClient` to short-circuit non-JSON 2xx responses to
 * `undefined as T` (mirroring the existing 204 branch).
 */
export async function markDialogRead(eventId: string): Promise<void> {
  await apiClient.post<void>(`/event/dialog/readed/${eventId}`, {});
}

export async function markGroupRead(eventId: string): Promise<void> {
  await apiClient.post<void>(`/event/group/readed/${eventId}`, {});
}

export async function getAllEvents(): Promise<{
  dialog: DialogEvent[];
  group: GroupEvent[];
}> {
  const [d, g] = await Promise.all([getDialogEvents(), getGroupEvents()]);
  return { dialog: d.items, group: g.items };
}
