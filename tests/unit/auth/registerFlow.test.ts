import { describe, expect, it } from "vitest";

import { ApiError, NetworkError } from "@/infra/error";
import {
  describeLoginError,
  describeRegisterError,
  validateRegisterForm,
} from "@/features/auth/registerFlow";

describe("auth/registerFlow validateRegisterForm", () => {
  it("accepts a valid form", () => {
    expect(validateRegisterForm("alice@example.com", "longpassword", "longpassword")).toBeNull();
  });

  it("rejects an email without @", () => {
    expect(validateRegisterForm("aliceexample.com", "longpassword", "longpassword")).toBe(
      "auth.register.errors.email",
    );
  });

  it("rejects an email without a dot", () => {
    expect(validateRegisterForm("alice@example", "longpassword", "longpassword")).toBe(
      "auth.register.errors.email",
    );
  });

  it("rejects empty email", () => {
    expect(validateRegisterForm("", "longpassword", "longpassword")).toBe(
      "auth.register.errors.email",
    );
  });

  it("rejects a 7-char password", () => {
    expect(validateRegisterForm("alice@example.com", "1234567", "1234567")).toBe(
      "auth.register.errors.passwordMin",
    );
  });

  it("accepts an 8-char password", () => {
    expect(validateRegisterForm("alice@example.com", "12345678", "12345678")).toBeNull();
  });

  it("rejects an empty password", () => {
    expect(validateRegisterForm("alice@example.com", "", "")).toBe(
      "auth.register.errors.passwordMin",
    );
  });

  it("rejects mismatched passwords", () => {
    expect(validateRegisterForm("alice@example.com", "12345678", "87654321")).toBe(
      "auth.register.errors.passwordsMismatch",
    );
  });

  it("checks email before password rules", () => {
    expect(validateRegisterForm("bad-email", "1234567", "99999999")).toBe(
      "auth.register.errors.email",
    );
  });

  it("checks password length before mismatch", () => {
    expect(validateRegisterForm("alice@example.com", "1234567", "99999999")).toBe(
      "auth.register.errors.passwordMin",
    );
  });

  it("trims email before checking (callers pass trimmed values)", () => {
    expect(validateRegisterForm("alice@example.com", "12345678", "12345678")).toBeNull();
  });
});

describe("auth/registerFlow describeLoginError", () => {
  it("maps ApiError 400 in approval mode to the pending hint", () => {
    const err = new ApiError(400, "LOGIN_BAD_CREDENTIALS");
    expect(describeLoginError(err, "approval")).toBe("auth.login.pendingHint");
  });

  it("returns null for ApiError 400 in open mode", () => {
    const err = new ApiError(400, "LOGIN_BAD_CREDENTIALS");
    expect(describeLoginError(err, "open")).toBeNull();
  });

  it("returns null for ApiError 400 in closed mode", () => {
    const err = new ApiError(400, "LOGIN_BAD_CREDENTIALS");
    expect(describeLoginError(err, "closed")).toBeNull();
  });

  it("returns null for other ApiError statuses in approval mode", () => {
    expect(describeLoginError(new ApiError(401, "unauthorized"), "approval")).toBeNull();
    expect(describeLoginError(new ApiError(500, "boom"), "approval")).toBeNull();
  });

  it("returns null for NetworkError and generic errors", () => {
    expect(describeLoginError(new NetworkError("offline"), "approval")).toBeNull();
    expect(describeLoginError(new Error("generic"), "approval")).toBeNull();
    expect(describeLoginError(null, "approval")).toBeNull();
  });
});

describe("auth/registerFlow describeRegisterError", () => {
  it("maps ApiError 403 to the closed error", () => {
    const err = new ApiError(403, "Registration is closed");
    expect(describeRegisterError(err)).toBe("auth.register.errors.closed");
  });

  it("returns null for other ApiError statuses", () => {
    expect(describeRegisterError(new ApiError(400, "REGISTER_USER_ALREADY_EXISTS"))).toBeNull();
    expect(describeRegisterError(new ApiError(500, "boom"))).toBeNull();
  });

  it("returns null for NetworkError and generic errors", () => {
    expect(describeRegisterError(new NetworkError("offline"))).toBeNull();
    expect(describeRegisterError(new Error("generic"))).toBeNull();
    expect(describeRegisterError("string error")).toBeNull();
  });
});
