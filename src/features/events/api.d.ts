import type { DialogEvent, GroupEvent, ListItems } from "./model";
export declare function getDialogEvents(): Promise<ListItems<DialogEvent>>;
export declare function getGroupEvents(): Promise<ListItems<GroupEvent>>;
/**
 * NOTE: backend returns HTML 200 with an empty body, not JSON.
 * `apiClient` currently falls through to `response.text()` for non-JSON
 * Content-Type and casts the result to `void` — this happens to work
 * because the empty string is ignored, but it is fragile. A follow-up
 * should teach `apiClient` to short-circuit non-JSON 2xx responses to
 * `undefined as T` (mirroring the existing 204 branch).
 */
export declare function markDialogRead(eventId: string): Promise<void>;
export declare function markGroupRead(eventId: string): Promise<void>;
export declare function getAllEvents(): Promise<{
    dialog: DialogEvent[];
    group: GroupEvent[];
}>;
