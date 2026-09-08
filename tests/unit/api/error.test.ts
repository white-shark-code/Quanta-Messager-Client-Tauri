import { describe, expect, it } from "vitest";

import {
  ApiError,
  ERROR_MAPPINGS,
  NetworkError,
  getErrorMapping,
  normalizeApiError,
  shouldLogout,
  toUserMessage,
} from "@/infra/error";

describe("error normalization", () => {
  describe("normalizeApiError", () => {
    it("creates an ApiError with the provided status and extracted detail string", () => {
      const err = normalizeApiError(401, { detail: "Invalid credentials" });

      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(401);
      expect(err.detail).toBe("Invalid credentials");
      expect(err.name).toBe("ApiError");
      expect(err.raw).toEqual({ detail: "Invalid credentials" });
    });

    it("joins validation items from {detail: array} with 'loc: msg' format", () => {
      const err = normalizeApiError(422, {
        detail: [
          { loc: ["body", "user"], msg: "field required", type: "value_error.missing" },
          { loc: ["body", "name"], msg: "must be string", type: "type_error" },
        ],
      });

      expect(err.status).toBe(422);
      expect(err.detail).toContain("body.user: field required");
      expect(err.detail).toContain("body.name: must be string");
      expect(err.detail.split("; ")).toHaveLength(2);
    });

    it("uses a generic Russian message when the body has no usable detail", () => {
      const err = normalizeApiError(500, { something: "else" });
      expect(err.status).toBe(500);
      expect(err.detail).toBe("Ошибка запроса");
    });

    it("returns the body string when the body is a plain string", () => {
      const err = normalizeApiError(502, "Bad Gateway");
      expect(err.detail).toBe("Bad Gateway");
    });

    it("returns generic message when the body is null", () => {
      const err = normalizeApiError(500, null);
      expect(err.detail).toBe("Ошибка запроса");
    });
  });

  describe("toUserMessage", () => {
    it("returns the mapped userMessage for a known ApiError status", () => {
      const err = new ApiError(401, "Invalid credentials");
      expect(toUserMessage(err)).toBe(ERROR_MAPPINGS[401]?.userMessage);
      expect(toUserMessage(err)).toBe("Сессия истекла, войдите снова");
    });

    it("returns mapped messages for other known statuses", () => {
      expect(toUserMessage(new ApiError(403, "Forbidden"))).toBe("Нет доступа");
      expect(toUserMessage(new ApiError(404, "Not found"))).toBe("Не найдено");
      expect(toUserMessage(new ApiError(405, "Need add public key"))).toBe(
        "Сначала добавьте публичный ключ в настройках",
      );
      expect(toUserMessage(new ApiError(413, "Too large"))).toBe(
        "Файл слишком большой (макс. 50 МБ)",
      );
      expect(toUserMessage(new ApiError(422, "Bad sig"))).toBe("Невалидные данные или подпись");
      expect(toUserMessage(new ApiError(500, "Server boom"))).toBe(
        "Ошибка сервера, попробуйте позже",
      );
    });

    it("falls back to err.detail for unknown status codes", () => {
      const err = new ApiError(418, "I am a teapot");
      expect(toUserMessage(err)).toBe("I am a teapot");
    });

    it("returns 'Нет связи с сервером' for NetworkError", () => {
      const err = new NetworkError("connection refused");
      expect(toUserMessage(err)).toBe("Нет связи с сервером");
    });

    it("returns err.message for plain Error instances", () => {
      const err = new Error("something weird");
      expect(toUserMessage(err)).toBe("something weird");
    });

    it("returns a fallback for non-Error values", () => {
      expect(toUserMessage("a string")).toBe("Неизвестная ошибка");
      expect(toUserMessage(undefined)).toBe("Неизвестная ошибка");
      expect(toUserMessage(null)).toBe("Неизвестная ошибка");
      expect(toUserMessage({ foo: "bar" })).toBe("Неизвестная ошибка");
    });
  });

  describe("shouldLogout", () => {
    it("returns true for ApiError with status 401", () => {
      expect(shouldLogout(new ApiError(401, "Unauthorized"))).toBe(true);
    });

    it("returns false for ApiError with status 500", () => {
      expect(shouldLogout(new ApiError(500, "Server error"))).toBe(false);
    });

    it("returns true based on mapping for status that has shouldLogout=true", () => {
      const mapping = getErrorMapping(401);
      expect(mapping.shouldLogout).toBe(true);
      expect(shouldLogout(new ApiError(401, "x"))).toBe(mapping.shouldLogout);
    });

    it("returns false for NetworkError", () => {
      expect(shouldLogout(new NetworkError("down"))).toBe(false);
    });

    it("returns false for unknown errors", () => {
      expect(shouldLogout(new Error("plain"))).toBe(false);
      expect(shouldLogout("string")).toBe(false);
      expect(shouldLogout(undefined)).toBe(false);
    });
  });

  describe("getErrorMapping", () => {
    it("returns FALLBACK for unknown statuses (e.g. 418)", () => {
      const mapping = getErrorMapping(418);
      expect(mapping.category).toBe("unknown");
      expect(mapping.shouldLogout).toBe(false);
    });

    it("returns the mapping for 413 with shouldRetry=false", () => {
      const mapping = getErrorMapping(413);
      expect(mapping.category).toBe("validation");
      expect(mapping.shouldRetry).toBe(false);
      expect(mapping.shouldLogout).toBe(false);
    });
  });
});
