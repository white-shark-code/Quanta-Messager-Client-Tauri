/**
 * Tolerant decoders for binary fields arriving over the JSON wire.
 *
 * Contract: binary columns (`bytes`/`bytea`) are base64-encoded by
 * FastAPI's `jsonable_encoder`, so the client receives base64 text.
 * Reality (observed live): some deployments serve raw ASCII-armored
 * text instead (DB column drift) — e.g. `public_key` arriving as
 * `-----BEGIN PGP PUBLIC KEY BLOCK-----...` with a 200 OK and
 * `has_public_key: true`. A plain `atob()` throws `InvalidCharacterError`
 * on the `-` chars, which used to fail whole lookups/decryptions with
 * no UI signal.
 *
 * Both helpers accept either shape and are behaviour-preserving for
 * canonical base64 (identical output to the old `atob` path). Garbage
 * that is neither armor nor valid base64 still throws, as before.
 *
 * Толерантные декодеры бинарных полей с JSON-провода.
 *
 * Контракт — base64, реальность — местами raw armor-текст (дрейф БД).
 * Оба хелпера принимают любую форму; для каноничного base64 выхлоп
 * побитово совпадает со старым `atob`-путём. Мусор по-прежнему бросает.
 */

/** Substring present in every ASCII-armored OpenPGP block we handle. */
const ARMOR_MARKER = "-----BEGIN";

/**
 * Decode a wire binary field into raw bytes.
 *
 * Armor text (message ciphertexts, signatures, keys served as text)
 * is UTF-8-encoded as-is; base64 is decoded. Used everywhere the
 * client turns a wire string into `Uint8Array` for OpenPGP.
 */
export function decodeWireBytes(value: string): Uint8Array {
  if (value.includes(ARMOR_MARKER)) {
    return new TextEncoder().encode(value);
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Decode a wire binary field into UTF-8 text (armored key material).
 *
 * Same tolerance as {@link decodeWireBytes}, then UTF-8-decoded.
 * Used for ASCII-armored PGP public keys from user-lookup endpoints.
 */
export function decodeWireText(value: string): string {
  return new TextDecoder().decode(decodeWireBytes(value));
}
