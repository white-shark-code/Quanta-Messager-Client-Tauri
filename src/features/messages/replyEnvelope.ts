/**
 * Reply envelope (Track B contract).
 *
 * Replies are encoded as a JSON envelope **before** encryption so the
 * ciphertext stays opaque to the backend and both copies (peer + self)
 * carry the same reply reference:
 *
 *   `{"v":1,"text":"...","reply":{"id":"...","sender":"...","preview":"..."}}`
 *
 * Plain (non-reply) messages are sent as raw text — never wrapped — so
 * `decodeBody` must treat any non-JSON / invalid payload as a plain body.
 */

export const REPLY_PREVIEW_LIMIT = 200;

export interface ReplyRef {
  id: string;
  sender: string;
  preview: string;
}

interface EnvelopeV1 {
  v: 1;
  text: string;
  reply: ReplyRef;
}

/** Slice a preview to {@link REPLY_PREVIEW_LIMIT} chars. Never throws. */
export function truncatePreview(text: string): string {
  return text.length > REPLY_PREVIEW_LIMIT ? text.slice(0, REPLY_PREVIEW_LIMIT) : text;
}

/**
 * Wrap `text` + parent ref into a v1 JSON envelope. The preview is
 * sliced to {@link REPLY_PREVIEW_LIMIT} so a long parent body can't
 * bloat every reply.
 */
export function encodeReplyBody(
  text: string,
  parent: { id: string; sender: string; preview: string },
): string {
  const envelope: EnvelopeV1 = {
    v: 1,
    text,
    reply: { id: parent.id, sender: parent.sender, preview: truncatePreview(parent.preview) },
  };
  return JSON.stringify(envelope);
}

/**
 * Split decrypted plaintext into `{ text, reply }`. Never throws:
 * non-JSON input or a structurally invalid envelope falls back to
 * `{ text: plaintext, reply: null }` (a plain pre-reply message, or a
 * message whose author typed literal JSON).
 */
export function decodeBody(plaintext: string): { text: string; reply: ReplyRef | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return { text: plaintext, reply: null };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { text: plaintext, reply: null };
  }
  const env = parsed as Partial<EnvelopeV1>;
  if (env.v !== 1 || typeof env.text !== "string") {
    return { text: plaintext, reply: null };
  }
  // A v1 envelope without a `reply` key is a plain (non-reply) message —
  // unwrap the text. But a PRESENT-yet-malformed `reply` means the payload
  // isn't one of ours (e.g. user-typed JSON), so keep the raw body.
  if (env.reply === undefined || env.reply === null) {
    return { text: env.text, reply: null };
  }
  const reply = env.reply as Partial<ReplyRef>;
  if (
    typeof reply.id !== "string" ||
    typeof reply.sender !== "string" ||
    typeof reply.preview !== "string"
  ) {
    return { text: plaintext, reply: null };
  }
  return { text: env.text, reply: { id: reply.id, sender: reply.sender, preview: reply.preview } };
}
