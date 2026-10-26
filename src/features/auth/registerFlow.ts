import { ApiError } from "@/infra/error";
import type { RegistrationMode } from "@/features/meta/api";

/**
 * Loose client-side email check — the server does the real validation, this
 * only catches obvious typos (missing "@" or domain dot) before a pointless
 * network round-trip.
 */
function isLooselyValidEmail(email: string): boolean {
  return email.includes("@") && email.includes(".");
}

/**
 * Pre-validate the register form client-side.
 *
 * Returns the i18n key of the first violated rule (evaluated in order:
 * email shape → password length → password confirmation) or `null` when
 * the form is acceptable. The returned key is meant to be passed straight
 * to `t()` by the caller.
 */
export function validateRegisterForm(
  email: string,
  password: string,
  confirmPassword: string,
): string | null {
  if (!isLooselyValidEmail(email)) {
    return "auth.register.errors.email";
  }
  if (password.length < 8) {
    return "auth.register.errors.passwordMin";
  }
  if (password !== confirmPassword) {
    return "auth.register.errors.passwordsMismatch";
  }
  return null;
}

/**
 * Presentation mapping for login errors in the registration-mode context.
 *
 * In "approval" mode a 400 LOGIN_BAD_CREDENTIALS is indistinguishable from
 * "account created but not approved yet" — surface the pending hint on top
 * of the generic message. Any other error (and the 400 in open/closed
 * modes) yields `null`, meaning the caller falls back to
 * `toUserMessage(err)` alone.
 */
export function describeLoginError(err: unknown, mode: RegistrationMode): string | null {
  if (err instanceof ApiError && err.status === 400 && mode === "approval") {
    return "auth.login.pendingHint";
  }
  return null;
}

/**
 * Presentation mapping for register errors. Any 403 on `/auth/register`
 * means registration is closed on the server — render the dedicated i18n
 * message instead of the generic "no access". Other errors yield `null`
 * (caller falls back to `toUserMessage(err)`).
 */
export function describeRegisterError(err: unknown): string | null {
  if (err instanceof ApiError && err.status === 403) {
    return "auth.register.errors.closed";
  }
  return null;
}
