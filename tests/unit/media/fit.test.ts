import { describe, expect, it } from "vitest";

import { fitMedia, MIN_DISPLAY_LONGEST, orientationOf } from "@/features/media/fit";

describe("media/fit", () => {
  it("classifies orientations", () => {
    expect(orientationOf(16, 9)).toBe("landscape");
    expect(orientationOf(9, 16)).toBe("portrait");
    expect(orientationOf(64, 64)).toBe("square");
  });

  it("covers fullscreen on matching ratio and orientation", () => {
    // 16:9 media on a 16:9 viewport → full bleed.
    const out = fitMedia(1920, 1080, 1920, 1080);
    expect(out.cover).toBe(true);
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
  });

  it("contains when orientations differ", () => {
    // Portrait clip on a landscape screen → letterboxed, centered.
    const out = fitMedia(1080, 1920, 1920, 1080);
    expect(out.cover).toBe(false);
    expect(out.width).toBeLessThanOrEqual(1920);
    expect(out.height).toBeLessThanOrEqual(1080);
    // Aspect preserved: 1080x1920 scaled to height 1080.
    expect(out.height).toBe(1080);
    expect(out.width).toBe(608);
  });

  it("contains on ratio mismatch even with matching orientation", () => {
    // 4:3 photo on a 16:9 screen → no crop.
    const out = fitMedia(800, 600, 1920, 1080);
    expect(out.cover).toBe(false);
    expect(out.height).toBe(1080);
    expect(out.width).toBe(1440);
  });

  it("gently upscales tiny sources", () => {
    // 64px black square → floored longest side, capped by viewport.
    const out = fitMedia(64, 64, 1920, 1080);
    expect(out.cover).toBe(false);
    expect(Math.max(out.width, out.height)).toBeGreaterThanOrEqual(MIN_DISPLAY_LONGEST);
    expect(out.width).toBeLessThanOrEqual(1920);
    expect(out.height).toBeLessThanOrEqual(1080);
    expect(out.width).toBe(out.height);
  });

  it("falls back to the viewport box on invalid input", () => {
    expect(fitMedia(0, 0, 1920, 1080)).toEqual({ cover: false, width: 1920, height: 1080 });
    expect(fitMedia(64, 64, 0, 0)).toEqual({ cover: false, width: 0, height: 0 });
    expect(fitMedia(Number.NaN, 64, 1920, 1080).cover).toBe(false);
  });
});
