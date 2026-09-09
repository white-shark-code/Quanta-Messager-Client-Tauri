export interface Chat {
    id: string;
    name: string;
}
export interface DialogChat extends Chat {
    user0: string;
    user1: string;
    create_at: string;
}
export interface GroupChat extends Chat {
    /** PGP public key for the group (base64 string on the wire; apiClient reviver handles bytes ↔ base64) */
    public_key: string;
    create_at: string;
}
export type AnyChat = DialogChat | GroupChat;
/**
 * Cursor-paginated response (matches backend's `AbstractUUIDPagginationBaseModel`).
 *
 * `last_id` is null when the page returned is empty or the last page.
 */
export interface PaginatedResponse<T> {
    page_size: number;
    count_pages: number;
    items: T[];
    last_id: string | null;
}
export interface CreatePrivateChatRequest {
    name: string;
    user: string;
}
/**
 * Backend requires `public_key: bytes` (PGP armored public key of the group).
 * Use the creator's own public key for MVP (per design.md §10 + report_for_backend/02
 * — group E2E not implemented yet).
 */
export interface CreateGroupChatRequest {
    name: string;
    /** ASCII-armored PGP public key (base64 on the wire via apiClient reviver) */
    public_key: string;
}
