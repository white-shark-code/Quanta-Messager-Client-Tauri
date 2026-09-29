import { beforeEach, describe, expect, it } from "vitest";

import { getUserPublicKey } from "@/features/users/api";
import { configureClient } from "@/infra/apiClient";

describe("users/api", () => {
  beforeEach(() => {
    configureClient({
      tokenProvider: () => null,
      onUnauthorized: () => undefined,
    });
  });

  describe("getUserPublicKey", () => {
    it("декодирует base64 wire-формат в ASCII-armored текст ключа", async () => {
      const result = await getUserPublicKey("user-2");

      expect(result.user_id).toBe("user-2");
      expect(result.has_public_key).toBe(true);
      expect(result.public_key).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
      expect(result.public_key).toContain("-----END PGP PUBLIC KEY BLOCK-----");
      // Не base64: armored-текст должен начинаться с маркера, а не с base64-тела.
      expect(result.public_key?.startsWith("LS0tLS1CRUdJTi")).toBe(false);
    });

    it("возвращает null public_key когда у пользователя нет ключа", async () => {
      const result = await getUserPublicKey("user-nokey");

      expect(result.has_public_key).toBe(false);
      expect(result.public_key).toBeNull();
    });
  });
});
