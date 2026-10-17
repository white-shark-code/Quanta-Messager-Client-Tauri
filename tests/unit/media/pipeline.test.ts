import * as openpgp from "openpgp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decryptFile,
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
} from "@/features/keyring/encrypt";
import { useKeyringStore } from "@/features/keyring/keyringStore";
import * as mediaApi from "@/features/media/api";
import {
  encryptAndUploadGroup,
  encryptAndUploadMultiplePrivate,
  encryptAndUploadPrivate,
  encryptMedia,
} from "@/features/media/pipeline";

vi.mock("@/features/media/api");

const PASSPHRASE = "media-pipeline-test-passphrase";
const BMP_BYTES = new Uint8Array([0x42, 0x4d, 0x36, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0]);

describe("media/pipeline", () => {
  let pub: openpgp.Key;
  let priv: openpgp.PrivateKey;

  beforeAll(async () => {
    const pair = await generateKeyPair(
      { name: "Media", email: "media@test.local" },
      PASSPHRASE,
      "ecc",
    );
    pub = await importPublicKey(pair.publicKeyArmored);
    priv = await importPrivateKey(pair.privateKeyArmored, PASSPHRASE);
  }, 60_000);

  beforeEach(() => {
    vi.restoreAllMocks();
    useKeyringStore.setState({ publicKey: null, privateKey: null, status: "empty" });
  });

  it("encryptMedia rejects a non-Blob input", async () => {
    await expect(encryptMedia("nope" as unknown as Blob, [pub], priv)).rejects.toThrow(
      /must be a Blob/,
    );
  });

  it("encryptMedia rejects an empty file", async () => {
    await expect(encryptMedia(new Blob([]), [pub], priv)).rejects.toThrow(/empty file/);
  });

  it("encryptMedia rejects files over the 50 MB limit", async () => {
    const big = new Blob([new Uint8Array(50 * 1024 * 1024 + 1)]);
    await expect(encryptMedia(big, [pub], priv)).rejects.toThrow(/exceeds limit/);
  });

  it("encryptMedia falls back to application/octet-stream without a MIME type", async () => {
    const out = await encryptMedia(new Blob([BMP_BYTES]), [pub], priv);
    expect(out.mime).toBe("application/octet-stream");
    expect(out.size).toBe(BMP_BYTES.length);
    expect(out.encrypted.length).toBeGreaterThan(0);
    expect(out.signature.length).toBeGreaterThan(0);
  });

  it("encryptMedia round-trips bytes through decryptFile (black BMP square)", async () => {
    const file = new File([BMP_BYTES], "black.bmp", { type: "image/bmp" });
    const out = await encryptMedia(file, [pub], priv);
    expect(out.mime).toBe("image/bmp");
    const back = await decryptFile(out.encrypted, out.signature, pub, priv);
    expect(back).toEqual(BMP_BYTES);
  });

  it("encryptAndUploadPrivate throws when the keyring is not ready", async () => {
    await expect(
      encryptAndUploadPrivate(new File([BMP_BYTES], "b.bmp", { type: "image/bmp" }), "chat"),
    ).rejects.toThrow(/keyring not ready/);
    expect(mediaApi.uploadPrivateMedia).not.toHaveBeenCalled();
  });

  it("encryptAndUploadPrivate posts base64 payload and maps the response", async () => {
    useKeyringStore.setState({ publicKey: pub, privateKey: priv, status: "ready" });
    vi.mocked(mediaApi.uploadPrivateMedia).mockResolvedValue({
      id: "media-1",
      mime_type: "image/bmp",
      file_size: BMP_BYTES.length,
      creation_datetime: "2026-10-16T00:00:00",
    });
    const out = await encryptAndUploadPrivate(
      new File([BMP_BYTES], "black.bmp", { type: "image/bmp" }),
      "chat-1",
    );
    expect(out).toEqual({
      id: "media-1",
      mime_type: "image/bmp",
      file_size: BMP_BYTES.length,
      creation_datetime: "2026-10-16T00:00:00",
    });
    const [chatId, req] = vi.mocked(mediaApi.uploadPrivateMedia).mock.calls[0]!;
    expect(chatId).toBe("chat-1");
    expect(req.mime_type).toBe("image/bmp");
    expect(req.file_size).toBe(BMP_BYTES.length);
    expect(typeof req.encrypted_file).toBe("string");
    expect(typeof req.signature).toBe("string");
  });

  it("encryptAndUploadGroup uses the group endpoint", async () => {
    useKeyringStore.setState({ publicKey: pub, privateKey: priv, status: "ready" });
    vi.mocked(mediaApi.uploadGroupMedia).mockResolvedValue({
      id: "media-g",
      mime_type: "image/bmp",
      file_size: BMP_BYTES.length,
      creation_datetime: "2026-10-16T00:00:00",
    });
    const out = await encryptAndUploadGroup(
      new File([BMP_BYTES], "black.bmp", { type: "image/bmp" }),
      "group-1",
    );
    expect(out.id).toBe("media-g");
    expect(vi.mocked(mediaApi.uploadGroupMedia).mock.calls[0]![0]).toBe("group-1");
  });

  it("encryptAndUploadMultiplePrivate uploads all files in parallel", async () => {
    useKeyringStore.setState({ publicKey: pub, privateKey: priv, status: "ready" });
    vi.mocked(mediaApi.uploadPrivateMedia).mockImplementation((_chatId, req) =>
      Promise.resolve({
        id: `m-${req.file_size}`,
        mime_type: req.mime_type,
        file_size: req.file_size,
        creation_datetime: "2026-10-16T00:00:00",
      }),
    );
    const out = await encryptAndUploadMultiplePrivate(
      [
        new File([BMP_BYTES], "a.bmp", { type: "image/bmp" }),
        new File([BMP_BYTES, BMP_BYTES], "b.bmp", { type: "image/bmp" }),
      ],
      "chat-1",
    );
    expect(out).toHaveLength(2);
    expect(vi.mocked(mediaApi.uploadPrivateMedia)).toHaveBeenCalledTimes(2);
  });

  it("encryptAndUploadPrivate encrypts to the peer key when provided", async () => {
    useKeyringStore.setState({ publicKey: pub, privateKey: priv, status: "ready" });
    const peerPair = await generateKeyPair(
      { name: "Peer", email: "peer@test.local" },
      PASSPHRASE,
      "ecc",
    );
    const peerPriv = await importPrivateKey(peerPair.privateKeyArmored, PASSPHRASE);
    let captured: { encrypted_file: string; signature: string } | null = null;
    vi.mocked(mediaApi.uploadPrivateMedia).mockImplementation((_chatId, req) => {
      captured = { encrypted_file: req.encrypted_file, signature: req.signature };
      return Promise.resolve({
        id: "media-peer",
        mime_type: "image/bmp",
        file_size: BMP_BYTES.length,
        creation_datetime: "2026-10-16T00:00:00",
      });
    });
    const out = await encryptAndUploadPrivate(
      new File([BMP_BYTES], "black.bmp", { type: "image/bmp" }),
      "chat-1",
      { peerPublicKeyArmored: peerPair.publicKeyArmored },
    );
    expect(out.id).toBe("media-peer");
    expect(captured).not.toBeNull();
    const enc = new Uint8Array(Buffer.from(captured!.encrypted_file, "base64"));
    const sig = new Uint8Array(Buffer.from(captured!.signature, "base64"));
    // The peer decrypts with their own private key (sender key = ours).
    const back = await decryptFile(enc, sig, pub, peerPriv);
    expect(back).toEqual(BMP_BYTES);
    // Our own key cannot open the peer-encrypted blob.
    await expect(decryptFile(enc, sig, pub, priv)).rejects.toThrow();
  });

  it("encryptAndUploadMultiplePrivate rejects when any upload fails", async () => {
    useKeyringStore.setState({ publicKey: pub, privateKey: priv, status: "ready" });
    vi.mocked(mediaApi.uploadPrivateMedia)
      .mockResolvedValueOnce({
        id: "ok",
        mime_type: "image/bmp",
        file_size: 1,
        creation_datetime: "2026-10-16T00:00:00",
      })
      .mockRejectedValueOnce(new Error("boom"));
    await expect(
      encryptAndUploadMultiplePrivate(
        [
          new File([BMP_BYTES], "a.bmp", { type: "image/bmp" }),
          new File([BMP_BYTES], "b.bmp", { type: "image/bmp" }),
        ],
        "chat-1",
      ),
    ).rejects.toThrow("boom");
  });
});
