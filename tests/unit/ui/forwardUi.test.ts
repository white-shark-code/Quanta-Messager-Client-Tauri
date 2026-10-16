// @vitest-environment jsdom
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { QueryClient } from "@tanstack/react-query";

import i18n from "@/i18n";
import { ForwardBar } from "@/features/messages/components/ForwardBar";
import { ForwardedMarker } from "@/features/messages/components/ForwardedMarker";
import { runForwardToTarget } from "@/features/messages/runForward";
import { useForwardStore } from "@/features/messages/forwardStore";

vi.mock("@/features/messages/forward", () => ({
  forwardMessages: vi.fn(),
}));

function resetStore(): void {
  useForwardStore.setState({ selection: {}, target: null });
}

/** jsdom has no `matchMedia`; MantineProvider only needs a static stub. */
function ensureMatchMedia(): void {
  const w = window as unknown as {
    matchMedia?: (query: string) => {
      matches: boolean;
      media: string;
      addEventListener: () => undefined;
      removeEventListener: () => undefined;
    };
  };
  if (typeof w.matchMedia !== "function") {
    w.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
  }
}

/** Client-render inside MantineProvider and return the resulting HTML. */
function renderHtml(el: ReactElement): string {
  const doc = document as unknown as {
    createElement(tag: string): { innerHTML: string; remove(): void };
    body: { appendChild(child: unknown): void };
  };
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  act(() => {
    root.render(createElement(MantineProvider, null, el));
  });
  const html = container.innerHTML;
  act(() => {
    root.unmount();
  });
  container.remove();
  return html;
}

describe("messages/forwardUi", () => {
  beforeAll(async () => {
    ensureMatchMedia();
    // `src/i18n` inits on import; wait until `t` interpolates for real.
    if (!i18n.isInitialized) {
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (i18n.isInitialized) {
            clearInterval(timer);
            resolve();
          }
        }, 5);
      });
    }
  });

  beforeEach(() => {
    resetStore();
  });

  it("entering selection mode selects the first message immediately", () => {
    // A single forward-button click (toggleSelect on an empty chat) must
    // already yield a one-item selection — no second click required.
    useForwardStore.getState().toggleSelect("c1", "m1");

    expect(useForwardStore.getState().selection.c1).toEqual(["m1"]);
  });

  it("ForwardBar shows the selected count and hides when empty", () => {
    useForwardStore.setState({ selection: { c1: ["m1", "m2"] } });

    const html = renderHtml(
      createElement(ForwardBar, { chatId: "c1", onProceed: () => undefined }),
    );
    expect(html).toContain("2");

    resetStore();
    const empty = renderHtml(
      createElement(ForwardBar, { chatId: "c1", onProceed: () => undefined }),
    );
    // MantineProvider still emits its `<style>` tag; the bar itself is gone.
    expect(empty).not.toContain("mantine-Paper");
  });

  it("picker row click forwards with the picked target ids", async () => {
    const send = vi.fn().mockResolvedValue({ sent: ["n1"], skipped: [], mediaSkipped: {} });
    const seen: unknown[] = [];
    const queryClient = new QueryClient();

    const result = await runForwardToTarget({
      queryClient,
      sourceChatId: "c1",
      sourceKind: "private",
      targetChatId: "c2",
      targetKind: "private",
      targetPeerKeyArmored: "ARMOR",
      messageIds: ["m1", "m2"],
      setTarget: (t) => {
        seen.push(t);
      },
      send,
    });

    expect(seen).toEqual([{ chatId: "c2", kind: "private" }]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      queryClient,
      sourceChatId: "c1",
      sourceKind: "private",
      targetChatId: "c2",
      targetKind: "private",
      targetPeerKeyArmored: "ARMOR",
      messageIds: ["m1", "m2"],
    });
    expect(result.sent).toEqual(["n1"]);
  });

  it("sent==0 stays open (empty result, caller shows an error)", async () => {
    const send = vi.fn().mockResolvedValue({
      sent: [],
      skipped: [{ id: "m1", reason: "locked" }],
      mediaSkipped: {},
    });

    const result = await runForwardToTarget({
      queryClient: new QueryClient(),
      sourceChatId: "c1",
      sourceKind: "private",
      targetChatId: "c2",
      targetKind: "private",
      targetPeerKeyArmored: null,
      messageIds: ["m1"],
      setTarget: () => undefined,
      send,
    });

    // Empty `sent` is how the picker knows to stay open with an error.
    expect(result.sent).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it("skipped>0 with sent items still navigates (warn inline)", async () => {
    const send = vi.fn().mockResolvedValue({
      sent: ["n1"],
      skipped: [{ id: "m2", reason: "locked" }],
      mediaSkipped: {},
    });

    const result = await runForwardToTarget({
      queryClient: new QueryClient(),
      sourceChatId: "c1",
      sourceKind: "private",
      targetChatId: "c2",
      targetKind: "private",
      targetPeerKeyArmored: "ARMOR",
      messageIds: ["m1", "m2"],
      setTarget: () => undefined,
      send,
    });

    // Sent items exist → the picker navigates; the skipped count feeds
    // the inline warning.
    expect(result.sent).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it("forwarded marker renders the label (button only for same-chat origin)", () => {
    const foreign = renderHtml(
      createElement(ForwardedMarker, {
        forwarded: { fromChat: "c9", fromMsg: "m9" },
        chatId: "c1",
      }),
    );
    expect(foreign).toMatch(/ереслан|Forwarded/);
    expect(foreign).not.toContain('role="button"');

    const local = renderHtml(
      createElement(ForwardedMarker, {
        forwarded: { fromChat: "c1", fromMsg: "m9" },
        chatId: "c1",
      }),
    );
    expect(local).toMatch(/ереслан|Forwarded/);
    expect(local).toContain('role="button"');
  });
});
