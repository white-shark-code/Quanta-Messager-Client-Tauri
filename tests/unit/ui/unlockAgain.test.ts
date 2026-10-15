import { describe, expect, it, vi } from "vitest";

import {
  isUnauthorizedError,
  resolveIndexIdentity,
  submitUnlockAgain,
  type UnlockAgainIdentity,
} from "@/features/auth/unlockAgain";
import type { KeystoreIndexEntry } from "@/features/secure-store/types";
import { ApiError } from "@/infra/error";

const IDENTITY: UnlockAgainIdentity = { userId: "user-1", email: "alice@example.com" };

function entry(userId: string, email: string, lastUsedAt: string): KeystoreIndexEntry {
  return { userId, email, lastUsedAt };
}

function makeDeps() {
  return {
    unlockWithPassphrase: vi.fn(
      // eslint-disable-next-line @typescript-eslint/require-await
      async (userId: string, keystorePassphrase: string, pgpPassphrase?: string) => {
        void userId;
        void keystorePassphrase;
        void pgpPassphrase;
      },
    ),
    me: vi.fn(() => Promise.resolve({ id: IDENTITY.userId, email: IDENTITY.email })),
    reauth: vi.fn(async (args: unknown) => {
      await Promise.resolve();
      void args;
    }),
  };
}

describe("unlockAgain.resolveIndexIdentity", () => {
  const users = [
    entry("user-old", "old@example.com", "2024-01-01T00:00:00.000Z"),
    entry("user-new", "new@example.com", "2026-10-01T00:00:00.000Z"),
  ];

  it("prefers the getLastUserId() candidate when it is in the index", () => {
    expect(resolveIndexIdentity(users, "user-old")).toEqual({
      userId: "user-old",
      email: "old@example.com",
    });
  });

  it("falls back to the freshest entry when the store is empty (null candidate)", () => {
    expect(resolveIndexIdentity(users, null)).toEqual({
      userId: "user-new",
      email: "new@example.com",
    });
  });

  it("falls back to the freshest entry when the candidate left the index", () => {
    expect(resolveIndexIdentity(users, "user-gone")).toEqual({
      userId: "user-new",
      email: "new@example.com",
    });
  });

  it("skips malformed entries (empty userId/email, unparsable date)", () => {
    const dirty: KeystoreIndexEntry[] = [
      { userId: "", email: "x@example.com", lastUsedAt: "2026-11-01T00:00:00.000Z" },
      { userId: "no-email", email: "", lastUsedAt: "2026-11-02T00:00:00.000Z" },
      { userId: "bad-date", email: "b@example.com", lastUsedAt: "not-a-date" },
      entry("user-ok", "ok@example.com", "2026-09-01T00:00:00.000Z"),
    ];
    expect(resolveIndexIdentity(dirty, null)).toEqual({
      userId: "user-ok",
      email: "ok@example.com",
    });
  });

  it("returns null for an empty index (modal shows noIdentity hint)", () => {
    expect(resolveIndexIdentity([], null)).toBeNull();
    expect(resolveIndexIdentity([], "user-1")).toBeNull();
  });
});

describe("unlockAgain.isUnauthorizedError", () => {
  it("detects ApiError 401", () => {
    expect(isUnauthorizedError(new ApiError(401, "unauthorized"))).toBe(true);
  });

  it("rejects ApiError with other statuses", () => {
    expect(isUnauthorizedError(new ApiError(403, "forbidden"))).toBe(false);
    expect(isUnauthorizedError(new ApiError(500, "server"))).toBe(false);
  });

  it("accepts duck-typed { status: 401 } (mocked transports)", () => {
    expect(isUnauthorizedError({ status: 401 })).toBe(true);
    expect(isUnauthorizedError({ status: 500 })).toBe(false);
  });

  it("rejects non-HTTP errors", () => {
    expect(isUnauthorizedError(new Error("boom"))).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
    expect(isUnauthorizedError(undefined)).toBe(false);
  });
});

describe("unlockAgain.submitUnlockAgain", () => {
  it("empty serverPassword → plain unlock + me probe → unlocked (no reauth)", async () => {
    const deps = makeDeps();
    const outcome = await submitUnlockAgain({
      identity: IDENTITY,
      keystorePassphrase: "k",
      serverPassword: "",
      deps,
    });

    expect(outcome).toEqual({ kind: "unlocked" });
    expect(deps.unlockWithPassphrase).toHaveBeenCalledTimes(1);
    expect(deps.unlockWithPassphrase).toHaveBeenCalledWith("user-1", "k", undefined);
    expect(deps.me).toHaveBeenCalledTimes(1);
    expect(deps.reauth).not.toHaveBeenCalled();
  });

  it("empty serverPassword → forwards a separate pgpPassphrase to unlock", async () => {
    const deps = makeDeps();
    await submitUnlockAgain({
      identity: IDENTITY,
      keystorePassphrase: "k",
      pgpPassphrase: "pgp",
      serverPassword: "",
      deps,
    });

    expect(deps.unlockWithPassphrase).toHaveBeenCalledWith("user-1", "k", "pgp");
  });

  it("empty serverPassword + me() 401 → needsReauth, reauth NOT called", async () => {
    const deps = makeDeps();
    deps.me.mockRejectedValueOnce(new ApiError(401, "expired"));

    const outcome = await submitUnlockAgain({
      identity: IDENTITY,
      keystorePassphrase: "k",
      serverPassword: "",
      deps,
    });

    expect(outcome).toEqual({ kind: "needsReauth" });
    expect(deps.unlockWithPassphrase).toHaveBeenCalledTimes(1);
    expect(deps.reauth).not.toHaveBeenCalled();
  });

  it("empty serverPassword + me() non-401 → propagates the error", async () => {
    const deps = makeDeps();
    deps.me.mockRejectedValueOnce(new ApiError(500, "server"));

    await expect(
      submitUnlockAgain({
        identity: IDENTITY,
        keystorePassphrase: "k",
        serverPassword: "",
        deps,
      }),
    ).rejects.toThrow("server");
    expect(deps.reauth).not.toHaveBeenCalled();
  });

  it("unlock failure propagates without calling me()", async () => {
    const deps = makeDeps();
    deps.unlockWithPassphrase.mockRejectedValueOnce(new Error("Wrong passphrase"));

    await expect(
      submitUnlockAgain({
        identity: IDENTITY,
        keystorePassphrase: "bad",
        serverPassword: "",
        deps,
      }),
    ).rejects.toThrow("Wrong passphrase");
    expect(deps.me).not.toHaveBeenCalled();
    expect(deps.reauth).not.toHaveBeenCalled();
  });

  it("filled serverPassword → reauth with locked identity email (no direct unlock/me)", async () => {
    const deps = makeDeps();
    const outcome = await submitUnlockAgain({
      identity: IDENTITY,
      keystorePassphrase: "k",
      serverPassword: "server-pass",
      deps,
    });

    expect(outcome).toEqual({ kind: "unlocked" });
    expect(deps.reauth).toHaveBeenCalledTimes(1);
    expect(deps.reauth).toHaveBeenCalledWith({
      userId: "user-1",
      email: "alice@example.com",
      keystorePassphrase: "k",
      serverPassword: "server-pass",
    });
    expect(deps.unlockWithPassphrase).not.toHaveBeenCalled();
    expect(deps.me).not.toHaveBeenCalled();
  });

  it("filled serverPassword → forwards pgpPassphrase into reauth", async () => {
    const deps = makeDeps();
    await submitUnlockAgain({
      identity: IDENTITY,
      keystorePassphrase: "k",
      pgpPassphrase: "pgp",
      serverPassword: "server-pass",
      deps,
    });

    expect(deps.reauth).toHaveBeenCalledWith({
      userId: "user-1",
      email: "alice@example.com",
      keystorePassphrase: "k",
      pgpPassphrase: "pgp",
      serverPassword: "server-pass",
    });
  });
});
