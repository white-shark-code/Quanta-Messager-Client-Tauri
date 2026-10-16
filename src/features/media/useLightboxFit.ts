import { useEffect, useMemo, useState } from "react";

import { fitMedia, type FittedSize } from "./fit";

/**
 * Viewport-aware media box for the fullscreen lightbox.
 *
 * Tracks `window` size (resize-aware) and maps the intrinsic media
 * size through {@link fitMedia}. `reservedH` is subtracted from the
 * viewport height upfront (lightbox header, player controls) so the
 * composed column can never overflow — the lightbox must not scroll.
 */
export function useLightboxFit(naturalW: number, naturalH: number, reservedH = 0): FittedSize {
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: Math.max(0, window.innerHeight - reservedH),
  }));

  useEffect(() => {
    const onResize = (): void => {
      setViewport({
        w: window.innerWidth,
        h: Math.max(0, window.innerHeight - reservedH),
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [reservedH]);

  return useMemo(
    () => fitMedia(naturalW, naturalH, viewport.w, viewport.h),
    [naturalW, naturalH, viewport.w, viewport.h],
  );
}
