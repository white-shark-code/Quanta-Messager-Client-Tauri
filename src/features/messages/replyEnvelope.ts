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

export interface ForwardRef {
  fromChat: string;
  fromMsg: string;
}

interface EnvelopeV1 {
  v: 1;
  text: string;
  reply?: ReplyRef | null;
  forwarded?: ForwardRef | null;
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
 * Wrap `text` + forward origin into a v1 JSON envelope. The reply link is
 * always `null` — forwarding drops it (see {@link stripForForward}).
 */
export function encodeForwardBody(text: string, origin: ForwardRef): string {
  return JSON.stringify({ v: 1, text, reply: null, forwarded: { ...origin } });
}

/** Check a parsed `reply` value is a well-formed {@link ReplyRef}. */
function isReplyRef(value: unknown): value is ReplyRef {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<ReplyRef>;
  return typeof r.id === "string" && typeof r.sender === "string" && typeof r.preview === "string";
}

/** Check a parsed `forwarded` value is a well-formed {@link ForwardRef}. */
function isForwardRef(value: unknown): value is ForwardRef {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Partial<ForwardRef>;
  return typeof f.fromChat === "string" && typeof f.fromMsg === "string";
}

/**
 * Split decrypted plaintext into `{ text, reply, forwarded }`. Never throws:
 * non-JSON input or a structurally invalid envelope falls back to
 * `{ text: plaintext, reply: null, forwarded: null }` (a plain pre-reply
 * message, or a message whose author typed literal JSON).
 */
export function decodeBody(plaintext: string): {
  text: string;
  reply: ReplyRef | null;
  forwarded: ForwardRef | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return { text: plaintext, reply: null, forwarded: null };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { text: plaintext, reply: null, forwarded: null };
  }
  const env = parsed as Partial<EnvelopeV1>;
  if (env.v !== 1 || typeof env.text !== "string") {
    return { text: plaintext, reply: null, forwarded: null };
  }
  // A v1 envelope without a `reply`/`forwarded` key is a plain message —
  // unwrap the text. But a PRESENT-yet-malformed value means the payload
  // isn't one of ours (e.g. user-typed JSON), so keep the raw body.
  let reply: ReplyRef | null = null;
  if (env.reply !== undefined && env.reply !== null) {
    if (!isReplyRef(env.reply)) {
      return { text: plaintext, reply: null, forwarded: null };
    }
    reply = { id: env.reply.id, sender: env.reply.sender, preview: env.reply.preview };
  }
  let forwarded: ForwardRef | null = null;
  if (env.forwarded !== undefined && env.forwarded !== null) {
    if (!isForwardRef(env.forwarded)) {
      return { text: plaintext, reply: null, forwarded: null };
    }
    forwarded = { fromChat: env.forwarded.fromChat, fromMsg: env.forwarded.fromMsg };
  }
  return { text: env.text, reply, forwarded };
}

/**
 * Strip the reply link before forwarding. The parent lives in another
 * chat, so keeping it would dead-end the jump.
 */
export function stripForForward(parsed: { text: string; reply: ReplyRef | null }): {
  text: string;
} {
  return { text: parsed.text };
}
