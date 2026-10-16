// @vitest-environment jsdom
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";

import i18n from "@/i18n";
import { MediaPreview, THUMB_MAX_W } from "@/features/media/components/MediaPreview";
import type { MediaAttachment } from "@/features/media/model";
import { downloadAndDecryptPrivate } from "@/features/media/decrypt";

vi.mock("@/features/media/decrypt", () => ({
  downloadAndDecryptPrivate: vi.fn(),
  downloadAndDecryptGroup: vi.fn(),
  revokeBlobUrl: vi.fn(),
}));

/**
 * Minimal structural DOM surface used by these tests.
 *
 * NOTE: keep this free of DOM type names (`Element`, `Blob`, …) and
 * touch the `document` global only inside function bodies — top-level
 * `document` references trip `no-unsafe-*` in this repo's eslint setup
 * (tests are outside `tsconfig.include`, so lib.dom globals resolve to
 * `error`). This mirrors the `renderHtml` approach in `forwardUi.test.ts`.
 */
interface TestEl {
  click(): void;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selectors: string): TestEl | null;
  querySelectorAll(selectors: string): ArrayLike<TestEl>;
  closest(selectors: string): TestEl | null;
  remove(): void;
}

interface TestDoc {
  createElement(tag: string): TestEl;
  body: { appendChild(child: unknown): void; innerHTML: string };
  querySelector(selectors: string): TestEl | null;
}

function testDoc(): TestDoc {
  return document as unknown as TestDoc;
}

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

function mount(el: ReactElement): { container: TestEl; unmount: () => void } {
  const doc = testDoc();
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  act(() => {
    root.render(createElement(MantineProvider, null, el));
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function click(el: TestEl | null): void {
  if (el === null) throw new Error("click target is null");
  act(() => {
    el.click();
  });
}

/** Flush pending React updates / promises inside `act`. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Real-timer wait inside `act` (for Mantine enter/exit transitions). */
async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  });
}

const BMP: MediaAttachment = {
  id: "m-thumb",
  mime_type: "image/bmp",
  file_size: 12342,
  creation_datetime: "2026-10-16T00:00:00",
};

function mockBlob(): void {
  vi.mocked(downloadAndDecryptPrivate).mockResolvedValue({
    blob: undefined as unknown as never,
    url: "blob:thumb",
    mime: "image/bmp",
  });
}

function loadButton(container: TestEl): TestEl {
  for (const btn of Array.from(container.querySelectorAll("button"))) {
    if ((btn.textContent ?? "").includes("Загрузить")) return btn;
  }
  throw new Error("load button not found");
}

describe("media/MediaPreview lightbox", () => {
  beforeAll(async () => {
    ensureMatchMedia();
    if (typeof URL.revokeObjectURL !== "function") {
      URL.revokeObjectURL = () => undefined;
    }
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    testDoc().body.innerHTML = "";
  });

  it("shows a Load button before the blob is fetched", () => {
    const { container, unmount } = mount(createElement(MediaPreview, { attachment: BMP }));
    expect(container.textContent).toContain("Загрузить");
    expect(testDoc().querySelector('img[src="blob:thumb"]')).toBeNull();
    unmount();
  });

  it("loads a size-capped thumbnail on click", async () => {
    mockBlob();
    const { container, unmount } = mount(createElement(MediaPreview, { attachment: BMP }));
    click(loadButton(container));
    await flush();
    const img = testDoc().querySelector('img[src="blob:thumb"]');
    expect(img).not.toBeNull();
    const box = img?.closest('[role="button"]');
    expect(box?.getAttribute("style")).toContain(`max-width: ${THUMB_MAX_W}px`);
    unmount();
  });

  it("opens a fullscreen dialog on thumbnail click and closes it", async () => {
    mockBlob();
    const { container, unmount } = mount(createElement(MediaPreview, { attachment: BMP }));
    click(loadButton(container));
    await flush();
    expect(testDoc().querySelector('[role="dialog"]')).toBeNull();
    click(testDoc().querySelector('[role="button"][aria-label]'));
    // Mantine mounts the Modal portal + transition asynchronously.
    await settle(50);
    const dialog = testDoc().querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('img[src="blob:thumb"]')).not.toBeNull();
    // Custom header CloseButton (explicit aria-label, next to download).
    click(dialog?.querySelector('[aria-label="Close"]') ?? null);
    // Exit transition unmounts the portal asynchronously.
    await settle(300);
    expect(testDoc().querySelector('[role="dialog"]')).toBeNull();
    unmount();
  });

  it("non-image attachments render a download card without a lightbox", () => {
    const pdf: MediaAttachment = { ...BMP, id: "m-pdf", mime_type: "application/pdf" };
    const { container, unmount } = mount(createElement(MediaPreview, { attachment: pdf }));
    expect(container.textContent).toContain("application/pdf");
    expect(container.querySelector('[role="button"]')).toBeNull();
    unmount();
  });
});
