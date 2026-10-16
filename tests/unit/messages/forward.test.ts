/**
 * Tests for `forwardMessages` (Track B).
 *
 * `keyring`, `messagesApi`, `media/api`, and the decryption cache are
 * `vi.mock`ed; the envelope codec (`encode/decodeBody`) and the query cache
 * are real. The media success test mocks the recon-positive path
 * (decrypt-then-re-encrypt works) to exercise the plumbing end to end.
 */
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useKeyringStore } from "@/features/keyring/keyringStore";
import type { DialogMessage } from "@/features/messages/model";
import { forwardMessages, type ForwardOptions } from "@/features/messages/forward";
import type { MessagesCache, PendingMessage } from "@/features/messages/mutations";
import { decodeBody } from "@/features/messages/replyEnvelope";

const stubs = vi.hoisted(() => ({
  decrypted: new Map<string, { text: string; verified: boolean; reply: unknown }>(),
  encryptTextCalls: [] as { body: string }[],
  sendReqs: [] as unknown[],
  mediaItems: [] as { id: string }[],
  failUpload: false,
}));

const FAKE_OWN_KEY = vi.hoisted(() => ({ marker: "own" }));
const FAKE_PEER_KEY = vi.hoisted(() => ({ marker: "peer" }));

vi.mock("@/features/messages/queries", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/features/messages/queries")>();
  return {
    ...orig,
    getDecrypted: (id: string) => {
      const entry = stubs.decrypted.get(id);
      return entry === undefined ? undefined : { ...entry };
    },
  };
});

vi.mock("@/features/keyring/encrypt", () => ({
  importPublicKey: vi.fn(() => Promise.resolve(FAKE_PEER_KEY)),
  encryptText: vi.fn((text: string) => {
    stubs.encryptTextCalls.push({ body: text });
    return Promise.resolve({
      encrypted: new TextEncoder().encode(`enc:${text}`),
      signature: new TextEncoder().encode(`sig:${text}`),
    });
  }),
  decryptFile: vi.fn((bytes: Uint8Array) => Promise.resolve(new Uint8Array(bytes))),
  encryptFile: vi.fn((bytes: Uint8Array) =>
    Promise.resolve({
      encrypted: new Uint8Array(bytes),
      signature: new TextEncoder().encode("fsig"),
    }),
  ),
}));

vi.mock("@/features/messages/api", () => ({
  sendPrivateMessage: vi.fn((_chatId: string, req: unknown) => {
    stubs.sendReqs.push(req);
    return Promise.resolve({
      id: `new-${stubs.sendReqs.length}`,
      chat_id: _chatId,
      owner_id: "user-me",
      encrypted_message: "ZW5j",
      signature: "c2ln",
      creation_datetime: "2026-09-08T00:00:00Z",
    });
  }),
  sendGroupMessage: vi.fn((_chatId: string, req: unknown) => {
    stubs.sendReqs.push(req);
    return Promise.resolve({
      id: `new-${stubs.sendReqs.length}`,
      chat_id: _chatId,
      owner_id: "user-me",
      encrypted_message: "ZW5j",
      signature: "c2ln",
      creation_datetime: "2026-09-08T00:00:00Z",
    });
  }),
  getPrivateMessages: vi.fn(),
  getGroupMessages: vi.fn(),
}));

vi.mock("@/features/media/api", () => ({
  listPrivateMedia: vi.fn(() => Promise.resolve({ items: stubs.mediaItems })),
  listGroupMedia: vi.fn(() => Promise.resolve({ items: stubs.mediaItems })),
  downloadPrivateMedia: vi.fn((mediaId: string) =>
    Promise.resolve({
      id: mediaId,
      mime_type: "image/png",
      file_size: 3,
      creation_datetime: "2026-09-08T00:00:00Z",
      encrypted_file: btoa("cipher"),
      signature: btoa("sig"),
      owner_id: "user-me",
    }),
  ),
  downloadGroupMedia: vi.fn((mediaId: string) =>
    Promise.resolve({
      id: mediaId,
      mime_type: "image/png",
      file_size: 3,
      creation_datetime: "2026-09-08T00:00:00Z",
      encrypted_file: btoa("cipher"),
      signature: btoa("sig"),
      owner_id: "user-me",
    }),
  ),
  uploadPrivateMedia: vi.fn(() => {
    if (stubs.failUpload) return Promise.reject(new Error("upload down"));
    return Promise.resolve({
      id: "new-att-1",
      mime_type: "image/png",
      file_size: 6,
      creation_datetime: "2026-09-08T00:00:00Z",
    });
  }),
  uploadGroupMedia: vi.fn(() => {
    if (stubs.failUpload) return Promise.reject(new Error("upload down"));
    return Promise.resolve({
      id: "new-att-1",
      mime_type: "image/png",
      file_size: 6,
      creation_datetime: "2026-09-08T00:00:00Z",
    });
  }),
}));

function makeRow(overrides: Partial<DialogMessage> = {}): DialogMessage {
  return {
    id: "m1",
    chat_id: "chat-1",
    owner_id: "user-bob",
    encrypted_message: "ZW5j",
    signature: "c2ln",
    creation_datetime: "2026-09-08T00:00:00Z",
    ...overrides,
  };
}

function makePending(overrides: Partial<PendingMessage> = {}): PendingMessage {
  return {
    ...makeRow({ id: "optimistic-1" }),
    status: "pending",
    text: "unsent draft",
    createdAt: Date.now(),
    optimistic: true,
    ...overrides,
  };
}

function seedCache(
  client: QueryClient,
  kind: "private" | "group",
  chatId: string,
  items: DialogMessage[],
): void {
  const cache: MessagesCache = { pages: [{ items }], pageParams: [0] };
  client.setQueryData(["messages", kind, chatId], cache);
}

function baseOpts(client: QueryClient, extra: Partial<ForwardOptions> = {}): ForwardOptions {
  return {
    queryClient: client,
    sourceChatId: "chat-1",
    sourceKind: "private",
    targetChatId: "chat-2",
    targetKind: "private",
    targetPeerKeyArmored: "peer-armor",
    messageIds: ["m1"],
    ...extra,
  };
}

beforeEach(() => {
  stubs.decrypted.clear();
  stubs.encryptTextCalls.length = 0;
  stubs.sendReqs.length = 0;
  stubs.mediaItems.length = 0;
  stubs.failUpload = false;
  vi.clearAllMocks();
  useKeyringStore.setState({
    publicKey: FAKE_OWN_KEY as never,
    privateKey: { marker: "priv" } as never,
  });
});

describe("forwardMessages", () => {
  it("forwards text with the origin marker in the envelope", async () => {
    const client = new QueryClient();
    seedCache(client, "private", "chat-1", [makeRow({ id: "m1" })]);
    stubs.decrypted.set("m1", { text: "hello", verified: true, reply: null });

    const result = await forwardMessages(baseOpts(client));

    expect(result).toEqual({ sent: ["new-1"], skipped: [], mediaSkipped: {} });
    expect(stubs.encryptTextCalls.length).toBeGreaterThan(0);
    const parsed = decodeBody(stubs.encryptTextCalls[0]!.body);
    expect(parsed.text).toBe("hello");
    expect(parsed.reply).toBeNull();
    expect(parsed.forwarded).toEqual({ fromChat: "chat-1", fromMsg: "m1" });
  });

  it("strips the source reply link (send body carries no reply)", async () => {
    const client = new QueryClient();
    seedCache(client, "private", "chat-1", [makeRow({ id: "m2" })]);
    stubs.decrypted.set("m2", {
      text: "inner",
      verified: true,
      reply: { id: "parent-9", sender: "alice", preview: "quoted" },
    });

    const result = await forwardMessages(baseOpts(client, { messageIds: ["m2"] }));

    expect(result.sent).toEqual(["new-1"]);
    const parsed = decodeBody(stubs.encryptTextCalls[0]!.body);
    expect(parsed.text).toBe("inner");
    expect(parsed.reply).toBeNull();
    expect(parsed.forwarded).toEqual({ fromChat: "chat-1", fromMsg: "m2" });
  });

  it("skips pending rows, unknown ids, and locked rows", async () => {
    const client = new QueryClient();
    seedCache(client, "private", "chat-1", [
      makePending({ id: "optimistic-1" }),
      makeRow({ id: "m-locked" }),
    ]);
    // m-locked has no decrypted text and no media → locked.

    const result = await forwardMessages(
      baseOpts(client, { messageIds: ["optimistic-1", "ghost", "m-locked"] }),
    );

    expect(result.sent).toEqual([]);
    expect(result.skipped).toEqual([
      { id: "optimistic-1", reason: "pending" },
      { id: "ghost", reason: "locked" },
      { id: "m-locked", reason: "locked" },
    ]);
    expect(stubs.sendReqs).toHaveLength(0);
  });

  it("marks text-less rows with attachments as media-only", async () => {
    const client = new QueryClient();
    seedCache(client, "private", "chat-1", [makeRow({ id: "m-media" })]);
    stubs.mediaItems.push({ id: "att-9" });

    const result = await forwardMessages(baseOpts(client, { messageIds: ["m-media"] }));

    expect(result.sent).toEqual([]);
    expect(result.skipped).toEqual([{ id: "m-media", reason: "media-only" }]);
    expect(stubs.sendReqs).toHaveLength(0);
  });

  it("attaches re-encrypted media_ids on the success path (cross-kind)", async () => {
    const client = new QueryClient();
    seedCache(client, "private", "chat-1", [makeRow({ id: "m3" })]);
    stubs.decrypted.set("m3", { text: "with media", verified: true, reply: null });
    stubs.mediaItems.push({ id: "att-1" });

    const result = await forwardMessages(
      baseOpts(client, { messageIds: ["m3"], targetKind: "group" }),
    );

    expect(result.sent).toEqual(["new-1"]);
    expect(result.mediaSkipped).toEqual({});
    const req = stubs.sendReqs[0] as { media_ids?: string[] };
    expect(req.media_ids).toEqual(["new-att-1"]);
  });

  it("counts per-media failures and still sends the text", async () => {
    const client = new QueryClient();
    seedCache(client, "private", "chat-1", [makeRow({ id: "m4" })]);
    stubs.decrypted.set("m4", { text: "text survives", verified: true, reply: null });
    stubs.mediaItems.push({ id: "att-bad" });
    stubs.failUpload = true;

    const result = await forwardMessages(baseOpts(client, { messageIds: ["m4"] }));

    expect(result.sent).toEqual(["new-1"]);
    expect(result.mediaSkipped).toEqual({ m4: 1 });
    const req = stubs.sendReqs[0] as { media_ids?: string[] };
    expect(req.media_ids).toBeUndefined();
  });
});
