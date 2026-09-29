import { describe, expect, it } from "vitest";

import { decrypt } from "@/features/secure-store/cipher";
import {
  DIALOG_MAGIC,
  DIALOG_VERSION,
  packDialog,
  parseDialog,
  serializeDialog,
} from "@/features/secure-store/format";

function fixedBytes(len: number, seed: number): Uint8Array {
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    buf[i] = (seed + i * 19) & 0xff;
  }
  return buf;
}

const FIXED_KEY = fixedBytes(32, 11);

describe("dialog format (QDLG1)", () => {
  it("сериализует и round-trip'ит payload, сохраняя chachaNonce и ciphertext", () => {
    const payload = [
      { id: "m1", chat_id: "c1", owner_id: "u1", encrypted_message: "AAAA", signature: null, creation_datetime: "2026-09-01T10:00:00.000Z" },
    ];

    const { ciphertext, chachaNonce } = serializeDialog(payload, FIXED_KEY);
    expect(ciphertext.length).toBeGreaterThan(0);
    expect(chachaNonce.length).toBe(12);

    const buf = packDialog({ ciphertext, chachaNonce });
    const parsed = parseDialog(buf);

    const recovered = decrypt(parsed.ciphertext, FIXED_KEY, parsed.chachaNonce);
    expect(JSON.parse(new TextDecoder().decode(recovered))).toEqual(payload);
  });

  it("раскладка header: magic(4) version(1) nonce(12) ciphertext(N+16)", () => {
    const payload = { items: [1, 2, 3] };
    const { ciphertext, chachaNonce } = serializeDialog(payload, FIXED_KEY);
    const buf = packDialog({ ciphertext, chachaNonce });

    expect(buf.slice(0, 4)).toEqual(DIALOG_MAGIC);
    expect(buf[4]).toBe(DIALOG_VERSION);
    expect(buf.slice(5, 17)).toEqual(chachaNonce);
    expect(buf.length).toBe(4 + 1 + 12 + ciphertext.length);
  });

  it("parse бросает на неверный magic", () => {
    const buf = packDialog(serializeDialog({ x: 1 }, FIXED_KEY));
    buf[0] = 0x00;
    expect(() => parseDialog(buf)).toThrow(/magic/i);
  });

  it("parse бросает на неподдерживаемую версию", () => {
    const buf = packDialog(serializeDialog({ x: 1 }, FIXED_KEY));
    buf[4] = 0x99;
    expect(() => parseDialog(buf)).toThrow(/version/i);
  });

  it("parse бросает на буфер короче header", () => {
    expect(() => parseDialog(new Uint8Array(10))).toThrow(/too short/i);
  });

  it("serializeDialog отвергает ключи длиной не 32 байта", () => {
    expect(() => serializeDialog({ x: 1 }, new Uint8Array(16))).toThrow(/32 bytes/);
  });
});
