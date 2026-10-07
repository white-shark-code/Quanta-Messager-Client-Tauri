import { describe, expect, it } from "vitest";

import { decodeWireBytes, decodeWireText } from "@/lib/wire";

const ARMOR_MESSAGE =
  "-----BEGIN PGP MESSAGE-----\n\nwV4DBxTMWxFKy64SAQdAtajhDwyd0J2HaqerjLBAUA/9k=\n-----END PGP MESSAGE-----\n";

function b64encodeText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe("lib/wire", () => {
  describe("decodeWireBytes", () => {
    it("декодирует каноничный base64 побитово как старый atob-путь", () => {
      const expected = new TextEncoder().encode(ARMOR_MESSAGE);
      const wire = b64encodeText(ARMOR_MESSAGE);

      expect(decodeWireBytes(wire)).toEqual(expected);
    });

    it("пропускает raw armor-текст как есть (дрейф бэкенда)", () => {
      const expected = new TextEncoder().encode(ARMOR_MESSAGE);

      expect(decodeWireBytes(ARMOR_MESSAGE)).toEqual(expected);
    });

    it("пропускает armor с ведущими пробелами/переносами", () => {
      const padded = `  \n${ARMOR_MESSAGE}`;
      const expected = new TextEncoder().encode(padded);

      expect(decodeWireBytes(padded)).toEqual(expected);
    });

    it("бросает на мусоре, который ни armor ни base64", () => {
      expect(() => decodeWireBytes("-----NOT-ARMOR-!!!")).toThrow();
    });
  });

  describe("decodeWireText", () => {
    it("декодирует base64-обёртку в armor-текст", () => {
      expect(decodeWireText(b64encodeText(ARMOR_MESSAGE))).toBe(ARMOR_MESSAGE);
    });

    it("возвращает raw armor без изменений", () => {
      expect(decodeWireText(ARMOR_MESSAGE)).toBe(ARMOR_MESSAGE);
    });
  });
});
