// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearOnboardingPending,
  getOnboardingPending,
  isOnboardingPendingFor,
  markOnboardingPending,
  ONBOARDING_PENDING_KEY,
  shouldResumeOnboarding,
} from "@/features/auth/onboardingPending";

/**
 * Node 22 ships a broken `localStorage` getter on `globalThis` that
 * Vitest's jsdom env does not override — same workaround as in
 * `tests/unit/infra/tauriBridge-browser.test.ts`: reinstall jsdom's
 * working Storage proxy as the canonical `localStorage`.
 */
function installJsdomLocalStorage(): void {
  const jsdomInstance = (globalThis as Record<string, unknown>).jsdom as
    | { window: { _localStorage: Storage } }
    | undefined;
  const jsdomLs = jsdomInstance?.window?._localStorage;
  if (!jsdomLs) return;
  delete (globalThis as Record<string, unknown>).localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    value: jsdomLs,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  installJsdomLocalStorage();
  localStorage.clear();
});

describe("auth/onboardingPending", () => {
  it("returns null when no flag is set", () => {
    expect(getOnboardingPending()).toBeNull();
    expect(isOnboardingPendingFor("user-1")).toBe(false);
  });

  it("round-trips mark → get → clear", () => {
    markOnboardingPending("user-1", "alice@example.com");

    const pending = getOnboardingPending();
    expect(pending).not.toBeNull();
    expect(pending?.userId).toBe("user-1");
    expect(pending?.email).toBe("alice@example.com");
    expect(Number.isNaN(Date.parse(pending?.startedAt ?? ""))).toBe(false);

    expect(isOnboardingPendingFor("user-1")).toBe(true);
    expect(isOnboardingPendingFor("user-2")).toBe(false);

    clearOnboardingPending();
    expect(getOnboardingPending()).toBeNull();
  });

  it("treats corrupt JSON as no flag", () => {
    localStorage.setItem(ONBOARDING_PENDING_KEY, "not-json{{{");
    expect(getOnboardingPending()).toBeNull();
    expect(isOnboardingPendingFor("user-1")).toBe(false);
  });

  it("shouldResumeOnboarding is true when flag set and no keystore on disk", async () => {
    markOnboardingPending("user-1", "alice@example.com");
    // Browser fallback: no `quant-keystore-<id>` in localStorage.
    await expect(shouldResumeOnboarding("user-1")).resolves.toBe(true);
  });

  it("shouldResumeOnboarding is false for another user or with a keystore present", async () => {
    markOnboardingPending("user-1", "alice@example.com");
    await expect(shouldResumeOnboarding("user-2")).resolves.toBe(false);

    localStorage.setItem("quant-keystore-user-1", "e30=");
    await expect(shouldResumeOnboarding("user-1")).resolves.toBe(false);
  });
});
