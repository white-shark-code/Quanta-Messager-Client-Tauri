/**
 * Fullscreen fit policy for the media lightbox.
 *
 * Pure function (no DOM) so it is unit-testable:
 * - orientations must match (landscape vs portrait; squares count as
 *   matching either) AND aspect ratios must agree within tolerance →
 *   `cover`: true fullscreen bleed, no letterbox;
 * - otherwise → `contain`: letterboxed, centered, never cropped;
 * - tiny sources are gently upscaled: the fitted longest side is
 *   floored at {@link MIN_DISPLAY_LONGEST} so a 64px test square does
 *   not render as a postage stamp (capped by the contain size and the
 *   viewport, never exceeding it).
 */

export const FIT_ASPECT_TOLERANCE = 0.03;
export const MIN_DISPLAY_LONGEST = 256;

export type MediaOrientation = "landscape" | "portrait" | "square";

export function orientationOf(w: number, h: number): MediaOrientation {
  if (w === h) return "square";
  return w > h ? "landscape" : "portrait";
}

export interface FittedSize {
  /** Full-bleed cover (exact screen fill) vs letterboxed contain. */
  cover: boolean;
  /** CSS pixel box to render the media in. */
  width: number;
  height: number;
}

export function fitMedia(
  naturalW: number,
  naturalH: number,
  viewportW: number,
  viewportH: number,
): FittedSize {
  if (
    !Number.isFinite(naturalW) ||
    !Number.isFinite(naturalH) ||
    naturalW <= 0 ||
    naturalH <= 0 ||
    !Number.isFinite(viewportW) ||
    !Number.isFinite(viewportH) ||
    viewportW <= 0 ||
    viewportH <= 0
  ) {
    return { cover: false, width: viewportW, height: viewportH };
  }
  const mediaOrientation = orientationOf(naturalW, naturalH);
  const viewportOrientation = orientationOf(viewportW, viewportH);
  const orientationMatch =
    mediaOrientation === viewportOrientation ||
    mediaOrientation === "square" ||
    viewportOrientation === "square";
  const aspectRatio = naturalW / naturalH;
  const viewportRatio = viewportW / viewportH;
  const ratioMatch = Math.abs(aspectRatio - viewportRatio) / viewportRatio <= FIT_ASPECT_TOLERANCE;

  if (orientationMatch && ratioMatch) {
    return { cover: true, width: viewportW, height: viewportH };
  }

  const containScale = Math.min(viewportW / naturalW, viewportH / naturalH);
  let width = Math.round(naturalW * containScale);
  let height = Math.round(naturalH * containScale);
  // Gentle upscale for tiny sources (pixel-art, test squares, stickers).
  const longest = Math.max(width, height);
  if (longest < MIN_DISPLAY_LONGEST) {
    const boost = Math.min(MIN_DISPLAY_LONGEST / longest, viewportW / width, viewportH / height);
    width = Math.round(width * boost);
    height = Math.round(height * boost);
  }
  return { cover: false, width, height };
}
