export declare function usePrivateChats(): import("@tanstack/react-query").UseInfiniteQueryResult<import("@tanstack/query-core").InfiniteData<import("./model").PaginatedResponse<import("./model").DialogChat>, unknown>, Error>;
export declare function useCreatePrivateChat(): import("@tanstack/react-query").UseMutationResult<import("./model").DialogChat, Error, import("./model").CreatePrivateChatRequest, unknown>;
export declare function useDeletePrivateChat(): import("@tanstack/react-query").UseMutationResult<import("./model").DialogChat, Error, string, unknown>;
/**
 * New: list group chats the current user is a member of.
 */
export declare function useGroupChats(): import("@tanstack/react-query").UseInfiniteQueryResult<import("@tanstack/query-core").InfiniteData<import("./model").PaginatedResponse<import("./model").GroupChat>, unknown>, Error>;
/**
 * Create a new group chat.
 * Backend requires `public_key` — for MVP we use the creator's own
 * public key (per design.md §10 + report_for_backend/02).
 */
export declare function useCreateGroupChat(): import("@tanstack/react-query").UseMutationResult<chatsApi.GroupChat, Error, {
    name: string;
}, unknown>;
export declare function usePrivateChat(chatId: string | undefined): import("@tanstack/react-query").UseQueryResult<import("./model").DialogChat, Error>;
