export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) {
    return r.value;
  }
  throw r.error;
}

export function map<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  if (r.ok) {
    return ok(fn(r.value));
  }
  return r;
}

export function mapErr<T, E, F>(r: Result<T, E>, fn: (e: E) => F): Result<T, F> {
  if (r.ok) {
    return r;
  }
  return err(fn(r.error));
}