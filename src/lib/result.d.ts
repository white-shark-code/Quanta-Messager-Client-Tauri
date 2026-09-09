export type Result<T, E = Error> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: E;
};
export declare function ok<T>(value: T): Result<T, never>;
export declare function err<E>(error: E): Result<never, E>;
export declare function isOk<T, E>(r: Result<T, E>): r is {
    ok: true;
    value: T;
};
export declare function isErr<T, E>(r: Result<T, E>): r is {
    ok: false;
    error: E;
};
export declare function unwrap<T, E>(r: Result<T, E>): T;
export declare function map<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E>;
export declare function mapErr<T, E, F>(r: Result<T, E>, fn: (e: E) => F): Result<T, F>;
