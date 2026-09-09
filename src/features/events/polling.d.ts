export declare function useEventsPolling(): import("@tanstack/react-query").UseQueryResult<{
    dialog: import("./model").DialogEvent[];
    group: import("./model").GroupEvent[];
}, Error>;
