/**
 * Format a media timestamp as `m:ss` for player UIs.
 *
 * Pure function (no DOM, no React) so unit tests can import it
 * without pulling the video-component module graph.
 */
export function formatMediaTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
