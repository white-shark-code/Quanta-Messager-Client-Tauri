import { useRef, useState } from "react";
import { ActionIcon, Group, Slider, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconMaximize,
  IconPlayerPause,
  IconPlayerPlay,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { formatMediaTime } from "../time";

/**
 * Minimal native video player (no third-party player library — zero
 * license questions, nothing to deprecate).
 *
 * Wraps a plain `<video>` fed by a decrypted `blob:` URL: play/pause,
 * seek slider, `m:ss` timestamps, mute toggle, fullscreen toggle.
 * Autoplay is deliberately off — browsers block unmuted autoplay and
 * chat media must never startle.
 */

/** Fixed chrome heights (px) subtracted from the viewport for fitting. */
export const LIGHTBOX_HEADER_H = 60;
export const PLAYER_CONTROLS_H = 48;

export function VideoPlayer({
  src,
  mediaStyle,
  controlsOverlay = false,
}: {
  src: string;
  /** Exact box for the `<video>` element (from `useLightboxFit`). */
  mediaStyle?: React.CSSProperties;
  /** Floating overlay controls (cover mode) vs a row below (contain). */
  controlsOverlay?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  async function togglePlay(): Promise<void> {
    const video = videoRef.current;
    if (video === null) return;
    try {
      if (video.paused) {
        await video.play();
      } else {
        video.pause();
      }
    } catch {
      // Autoplay policy / teardown races surface here; the `play` /
      // `pause` / `ended` events below are the source of truth.
    }
  }

  function seek(value: number): void {
    const video = videoRef.current;
    if (video === null) return;
    video.currentTime = value;
    setCurrentTime(value);
  }

  function toggleMute(): void {
    const video = videoRef.current;
    if (video === null) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function goFullscreen(): void {
    const box = boxRef.current;
    if (box === null || document.fullscreenElement !== null) return;
    void box.requestFullscreen().catch(() => undefined);
  }

  const playLabel = t("media.play", { defaultValue: "Play" });
  const pauseLabel = t("media.pause", { defaultValue: "Pause" });

  const controls = (
    <Group gap="xs" wrap="nowrap" style={{ width: "100%" }}>
      <Tooltip label={playing ? pauseLabel : playLabel}>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={playing ? pauseLabel : playLabel}
          onClick={() => void togglePlay()}
        >
          {playing ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
        </ActionIcon>
      </Tooltip>
      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
        {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
      </Text>
      <Slider
        value={Number.isFinite(currentTime) ? currentTime : 0}
        max={Number.isFinite(duration) && duration > 0 ? duration : 0}
        onChange={seek}
        size="xs"
        style={{ flex: 1 }}
        aria-label={t("media.seek", { defaultValue: "Seek" })}
      />
      <Tooltip
        label={
          muted
            ? t("media.unmute", { defaultValue: "Unmute" })
            : t("media.mute", { defaultValue: "Mute" })
        }
      >
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={toggleMute}
        >
          {muted ? <IconVolumeOff size={14} /> : <IconVolume size={14} />}
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("media.fullscreen", { defaultValue: "Fullscreen" })}>
        <ActionIcon variant="subtle" size="sm" aria-label="Fullscreen" onClick={goFullscreen}>
          <IconMaximize size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  if (controlsOverlay) {
    return (
      <div ref={boxRef} style={{ position: "relative", width: "100%", height: "100%" }}>
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          playsInline
          onClick={() => void togglePlay()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          style={{ ...mediaStyle, display: "block" }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "4px 8px",
            background: "linear-gradient(transparent, rgba(0,0,0,0.65))",
          }}
        >
          {controls}
        </div>
      </div>
    );
  }

  return (
    <Stack gap={4} style={{ width: "100%" }}>
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        playsInline
        onClick={() => void togglePlay()}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        style={{ width: "100%", maxHeight: "100%", backgroundColor: "black", ...mediaStyle }}
      />
      <div ref={boxRef} style={{ width: "100%" }}>
        {controls}
      </div>
    </Stack>
  );
}
