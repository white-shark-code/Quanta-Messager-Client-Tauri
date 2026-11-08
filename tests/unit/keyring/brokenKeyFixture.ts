/**
 * Test fixture: synthesize a key with an INVALID self-signature.
 *
 * Some keys in the wild were minted by an old buggy build and carry a
 * self-signature that does not match their User ID packet. openpgp
 * reports it as
 *
 *     Could not find valid self-signature in key <fp>: Signed digest did not match
 *
 * and every consumer rejects such a key — the backend's GnuPG import
 * among them.
 *
 * The fixture is built by **byte surgery on a freshly generated key**
 * (no real user key ever enters the repo):
 *
 *   1. strip the ASCII-armor envelope and base64-decode the body,
 *   2. walk the OpenPGP packet list and find the User ID packet
 *      (tag 13),
 *   3. flip ONE byte inside the User ID **name** region — the packet
 *      headers and lengths stay intact, so the key still parses and
 *      the secret material still unlocks,
 *   4. re-wrap the bytes as ASCII armor.
 *
 * The self-signature covers the User ID packet, so the mutated name no
 * longer matches the signed digest — exactly the live failure mode.
 */

/** Armor header of the private key block. */
const PRIVATE_KEY_LABEL = "PGP PRIVATE KEY BLOCK";

/** OpenPGP packet tag of a User ID packet. */
const USER_ID_PACKET_TAG = 13;

/**
 * Strip the armor envelope and base64-decode the body.
 *
 * Header lines (`Version: …`) and the optional CRC line (`=XXXX`) are
 * dropped — base64 never contains a colon or a space, so the filter
 * cannot eat payload.
 */
function decodeArmored(armored: string): Uint8Array {
  const body = armored
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("-----") &&
        !line.startsWith("=") &&
        !line.includes(": ") &&
        line.trim().length > 0,
    )
    .join("");
  return new Uint8Array(Buffer.from(body, "base64"));
}

/**
 * Re-wrap raw packet bytes as ASCII armor (60 base64 chars per line,
 * no CRC line — the same shape openpgp.js emits).
 */
function encodeArmored(bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString("base64");
  const lines = base64.match(/.{1,60}/g) ?? [];
  return [
    `-----BEGIN ${PRIVATE_KEY_LABEL}-----`,
    "",
    ...lines,
    `-----END ${PRIVATE_KEY_LABEL}-----`,
    "",
  ].join("\n");
}

/**
 * Read the header of the packet that starts at `offset`.
 *
 * Handles both the old (1/2/4-byte length) and the new (1/2/5-byte
 * length) packet formats — partial lengths only exist for data
 * packets and are rejected.
 */
function readPacketHeader(
  bytes: Uint8Array,
  offset: number,
): {
  tag: number;
  length: number;
  bodyStart: number;
} {
  const tagByte = bytes[offset];
  if (tagByte === undefined) {
    throw new Error("corruptUserIdPacket: read past the end of the packet list");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if ((tagByte & 0x40) !== 0) {
    // New format.
    const tag = tagByte & 0x3f;
    const first = bytes[offset + 1] ?? 0;
    if (first < 192) {
      return { tag, length: first, bodyStart: offset + 2 };
    }
    if (first < 224) {
      const length = ((first - 192) << 8) + (bytes[offset + 2] ?? 0) + 192;
      return { tag, length, bodyStart: offset + 3 };
    }
    if (first === 255) {
      return { tag, length: view.getUint32(offset + 2), bodyStart: offset + 6 };
    }
    throw new Error("corruptUserIdPacket: partial packet lengths are not supported");
  }
  // Old format.
  const tag = tagByte & 0x3f;
  const lengthByte = bytes[offset + 1] ?? 0;
  if (lengthByte < 192) {
    return { tag, length: lengthByte, bodyStart: offset + 2 };
  }
  if (lengthByte < 224) {
    const length = ((lengthByte - 192) << 8) + (bytes[offset + 2] ?? 0) + 192;
    return { tag, length, bodyStart: offset + 3 };
  }
  if (lengthByte === 255) {
    return { tag, length: view.getUint32(offset + 2), bodyStart: offset + 6 };
  }
  throw new Error("corruptUserIdPacket: partial packet lengths are not supported");
}

/**
 * Corrupt the User ID of an armored private key: one byte of the name
 * is flipped, which invalidates the self-signature while leaving the
 * key parseable and unlockable.
 *
 * @param armoredPrivate Armored private key block.
 * @returns The same key with an invalid self-signature.
 */
export function corruptUserIdPacket(armoredPrivate: string): string {
  const bytes = decodeArmored(armoredPrivate);

  let offset = 0;
  let userIdBodyStart = -1;
  let userIdLength = 0;
  while (offset < bytes.length) {
    const header = readPacketHeader(bytes, offset);
    if (header.tag === USER_ID_PACKET_TAG) {
      userIdBodyStart = header.bodyStart;
      userIdLength = header.length;
      break;
    }
    offset = header.bodyStart + header.length;
  }
  if (userIdBodyStart < 0) {
    throw new Error("corruptUserIdPacket: no User ID packet found in the key");
  }

  // The User ID body is the raw "Name <email>" string. Flip a byte of
  // the NAME part (the email is left intact so the key can still be
  // re-certified with a sane identity).
  const userIdText = Buffer.from(
    bytes.subarray(userIdBodyStart, userIdBodyStart + userIdLength),
  ).toString("latin1");
  const emailStart = userIdText.indexOf("<");
  const nameLength = emailStart > 0 ? emailStart : userIdText.length;
  if (nameLength === 0) {
    throw new Error("corruptUserIdPacket: the User ID has no name to corrupt");
  }

  const corrupted = bytes.slice();
  const flipAt = userIdBodyStart;
  corrupted[flipAt] = (corrupted[flipAt] ?? 0) ^ 0x01;

  return encodeArmored(corrupted);
}
