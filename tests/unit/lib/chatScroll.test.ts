import { describe, expect, it } from "vitest";

import {
  isNearBottomDims,
  NEAR_BOTTOM_THRESHOLD_PX,
  restoreScrollTopAfterPrepend,
} from "@/lib/useChatScroll";

describe("useChatScroll pure helpers (Task 2)", () => {
  describe("isNearBottomDims", () => {
    it("returns true exactly at the bottom", () => {
      // scrollHeight - scrollTop - clientHeight === 0
      expect(isNearBottomDims(1000, 900, 100)).toBe(true);
    });

    it("returns false far from the bottom", () => {
      expect(isNearBottomDims(2000, 500, 100)).toBe(false);
    });

    it("returns true within the default threshold", () => {
      const gap = NEAR_BOTTOM_THRESHOLD_PX - 1;
      expect(isNearBottomDims(1000 + gap, 900, 100)).toBe(true);
    });

    it("returns false just outside the default threshold", () => {
      const gap = NEAR_BOTTOM_THRESHOLD_PX + 1;
      expect(isNearBottomDims(1000 + gap, 900, 100)).toBe(false);
    });

    it("respects a custom threshold override", () => {
      // Gap of 50px: outside a 10px threshold, inside a 100px one.
      expect(isNearBottomDims(1050, 900, 100, 10)).toBe(false);
      expect(isNearBottomDims(1050, 900, 100, 100)).toBe(true);
    });
  });

  describe("restoreScrollTopAfterPrepend", () => {
    it("shifts scrollTop by the prepended height, preserving the viewport offset", () => {
      // 300px of earlier messages loaded above: height 1000 -> 1300,
      // the user's viewport (was at 200) must move to 500.
      expect(restoreScrollTopAfterPrepend({ scrollHeight: 1000, scrollTop: 200 }, 1300)).toBe(500);
    });

    it("keeps scrollTop unchanged when nothing was prepended", () => {
      expect(restoreScrollTopAfterPrepend({ scrollHeight: 1000, scrollTop: 200 }, 1000)).toBe(200);
    });

    it("preserves the bottom-anchored position when prepended at the bottom", () => {
      // Was at the very bottom (1000 - 900 - 100 = 0); 300px prepended.
      expect(restoreScrollTopAfterPrepend({ scrollHeight: 1000, scrollTop: 900 }, 1300)).toBe(1200);
    });
  });
});
