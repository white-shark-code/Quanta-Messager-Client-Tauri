export function ok(value) {
    return { ok: true, value };
}
export function err(error) {
    return { ok: false, error };
}
export function isOk(r) {
    return r.ok;
}
export function isErr(r) {
    return !r.ok;
}
export function unwrap(r) {
    if (r.ok) {
        return r.value;
    }
    throw r.error;
}
export function map(r, fn) {
    if (r.ok) {
        return ok(fn(r.value));
    }
    return r;
}
export function mapErr(r, fn) {
    if (r.ok) {
        return r;
    }
    return err(fn(r.error));
}
