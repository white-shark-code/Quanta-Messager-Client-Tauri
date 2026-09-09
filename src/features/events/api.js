import { apiClient } from "@/infra/apiClient";
export async function getDialogEvents() {
    return apiClient.get("/event/dialogs/");
}
export async function getGroupEvents() {
    return apiClient.get("/event/groups/");
}
/**
 * NOTE: backend returns HTML 200 with an empty body, not JSON.
 * `apiClient` currently falls through to `response.text()` for non-JSON
 * Content-Type and casts the result to `void` — this happens to work
 * because the empty string is ignored, but it is fragile. A follow-up
 * should teach `apiClient` to short-circuit non-JSON 2xx responses to
 * `undefined as T` (mirroring the existing 204 branch).
 */
export async function markDialogRead(eventId) {
    await apiClient.post(`/event/dialog/readed/${eventId}`, {});
}
export async function markGroupRead(eventId) {
    await apiClient.post(`/event/group/readed/${eventId}`, {});
}
export async function getAllEvents() {
    const [d, g] = await Promise.all([getDialogEvents(), getGroupEvents()]);
    return { dialog: d.items, group: g.items };
}
