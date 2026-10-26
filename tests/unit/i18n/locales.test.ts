// Security rule false positive: the fs paths are hardcoded URLs pointing at the
// locale fixtures, never user input.
/* eslint-disable security/detect-non-literal-fs-filename */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type Locale = "en" | "ru" | "vi";

const LOCALES: Locale[] = ["en", "ru", "vi"];

type Json = Record<string, unknown>;

const files: Record<Locale, Json> = {
  en: JSON.parse(
    readFileSync(new URL("../../../src/i18n/locales/en.json", import.meta.url), "utf8"),
  ) as Json,
  ru: JSON.parse(
    readFileSync(new URL("../../../src/i18n/locales/ru.json", import.meta.url), "utf8"),
  ) as Json,
  vi: JSON.parse(
    readFileSync(new URL("../../../src/i18n/locales/vi.json", import.meta.url), "utf8"),
  ) as Json,
};

function keyPaths(value: unknown, prefix: string): string[] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Json).flatMap(([key, child]) =>
      keyPaths(child, `${prefix}.${key}`),
    );
  }
  return [prefix];
}

function get(root: Json, keyPath: string): unknown {
  let current: unknown = root;
  for (const segment of keyPath.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Json)[segment];
  }
  return current;
}

function diffKeyPaths(a: Locale, b: Locale, prefix: string): string[] {
  const aPaths = new Set(keyPaths(get(files[a], prefix) ?? {}, prefix));
  const bPaths = new Set(keyPaths(get(files[b], prefix) ?? {}, prefix));
  return [
    [...aPaths].filter((p) => !bPaths.has(p)).map((p) => `${a}: ${p}`),
    [...bPaths].filter((p) => !aPaths.has(p)).map((p) => `${b}: ${p}`),
  ].flat();
}

/**
 * Keys that must exist (non-empty) in every locale.
 *
 * The strict full-tree key parity across locales is NOT asserted here, because
 * the three locale files intentionally (pre-existing) diverge outside the
 * `auth.login` / `auth.register` sections (e.g. vi has extra `auth.errors.*`,
 * `auth.setupKey`, while en/ru have extra `auth.unlock.*` keys); those sections
 * are out of scope. Parity is enforced for the subtrees below, which guards the
 * "Vietnamese locale forgot a key" class of bugs for the auth sections.
 */
const PARITY_PREFIXES = ["auth.login", "auth.register"] as const;

const REQUIRED_KEYS = [
  "auth.login.title",
  "auth.login.email",
  "auth.login.password",
  "auth.login.submit",
  "auth.login.noAccount",
  "auth.login.registerLink",
  "auth.login.pendingHint",
  "auth.register.title",
  "auth.register.email",
  "auth.register.password",
  "auth.register.confirmPassword",
  "auth.register.submit",
  "auth.register.submitting",
  "auth.register.haveAccount",
  "auth.register.loginLink",
  "auth.register.approvalNote",
  "auth.register.pendingTitle",
  "auth.register.pendingText",
  "auth.register.pendingBackToLogin",
  "auth.register.errors.passwordMin",
  "auth.register.errors.passwordsMismatch",
  "auth.register.errors.closed",
] as const;

describe("i18n/locales", () => {
  it("auth.login and auth.register have identical key paths in every locale", () => {
    const offending: string[] = [];
    for (const prefix of PARITY_PREFIXES) {
      offending.push(...diffKeyPaths("en", "ru", prefix), ...diffKeyPaths("en", "vi", prefix));
    }
    expect(offending).toEqual([]);
  });

  it("every locale has all required auth/login and auth/register keys non-empty", () => {
    for (const locale of LOCALES) {
      for (const keyPath of REQUIRED_KEYS) {
        const value = get(files[locale], keyPath);
        expect(value, `${locale}: ${keyPath} missing`).toBeTruthy();
        expect(typeof value, `${locale}: ${keyPath} must be a string`).toBe("string");
      }
    }
  });

  it("vi keeps chat-related auth.errors while password errors moved to auth.register.errors", () => {
    const viAuthErrors = get(files.vi, "auth.errors") as Json;
    expect(get(files.vi, "auth.register.errors.passwordMin")).toBeTruthy();
    expect(get(files.vi, "auth.register.errors.passwordsMismatch")).toBeTruthy();
    expect(viAuthErrors).not.toHaveProperty("passwordMin");
    expect(viAuthErrors).not.toHaveProperty("passwordsMismatch");
    // Untouched chat-related error keys stay in auth.errors, and nothing else.
    expect(Object.keys(viAuthErrors).sort()).toEqual(["invalidUuid", "notLoggedIn", "selfChat"]);
    for (const key of ["invalidUuid", "notLoggedIn", "selfChat"]) {
      expect(viAuthErrors[key], `auth.errors.${key} must stay`).toBeTruthy();
    }
  });
});
