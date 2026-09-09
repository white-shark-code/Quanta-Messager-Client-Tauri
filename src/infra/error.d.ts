export interface FastApiValidationItem {
    readonly loc?: ReadonlyArray<unknown>;
    readonly msg?: string;
    readonly type?: string;
}
export interface FastApiErrorBody {
    readonly detail?: string | ReadonlyArray<FastApiValidationItem>;
}
export declare class ApiError extends Error {
    readonly status: number;
    readonly detail: string;
    readonly raw: unknown;
    constructor(status: number, detail: string, raw?: unknown);
}
export declare class NetworkError extends Error {
    constructor(message: string, errCause?: unknown);
}
export declare function normalizeApiError(status: number, body: unknown): ApiError;
export type ErrorCategory = "network" | "auth" | "permission" | "notfound" | "validation" | "server" | "client" | "unknown";
export interface ErrorMapping {
    readonly category: ErrorCategory;
    readonly userMessage: string;
    readonly shouldRetry: boolean;
    readonly shouldLogout: boolean;
}
export declare const ERROR_MAPPINGS: Record<number, ErrorMapping>;
export declare function getErrorMapping(status: number): ErrorMapping;
export declare function toUserMessage(err: unknown): string;
export declare function shouldLogout(err: unknown): boolean;
