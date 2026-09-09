export interface CapturedMessageApiRequest {
    method: string;
    url: string;
    body: unknown;
    query: URLSearchParams;
}
export declare const capturedMessageApi: {
    privateList: CapturedMessageApiRequest | null;
    privateSend: CapturedMessageApiRequest | null;
    groupList: CapturedMessageApiRequest | null;
    groupSend: CapturedMessageApiRequest | null;
};
export declare function resetMessageApiCaptures(): void;
export declare const handlers: import("msw").HttpHandler[];
