import { useEffect, useState } from "react";
import {
  ActionIcon,
  AspectRatio,
  Box,
  Button,
  Center,
  CloseButton,
  Group,
  Image,
  Loader,
  Modal,
  Paper,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconDownload, IconFile, IconPlayerPlay } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  downloadAndDecryptGroup,
  downloadAndDecryptPrivate,
  peekVaultMedia,
  revokeBlobUrl,
} from "../decrypt";
import type { MediaVaultContext } from "../decrypt";
import type { MediaAttachment } from "../model";
import { formatMediaTime } from "../time";
import { LIGHTBOX_HEADER_H, PLAYER_CONTROLS_H, VideoPlayer } from "./VideoPlayer";
import { useLightboxFit } from "../useLightboxFit";

/**
 * Thumbnail bounds: message-list previews never exceed this box,
 * whatever the source resolution is (a 4000px photo and the 64px test
 * square render at most this large). `fit="contain"` keeps the aspect
 * ratio — no cropping.
 */
export const THUMB_MAX_W = 240;
export const THUMB_MAX_H = 180;

interface MediaPreviewProps {
  attachment: MediaAttachment;
  kind?: "private" | "group";
  /** Vault linkage (chat/message) for per-chat purge accounting. */
  context?: MediaVaultContext;
}

/**
 * Fullscreen media area: no scroll, ever. Cover mode bleeds to the
 * viewport edges; contain mode centers the fitted box.
 */
function LightboxBody({
  isVideo,
  url,
  mime,
  natural,
}: {
  isVideo: boolean;
  url: string;
  mime: string;
  natural: { w: number; h: number };
}): JSX.Element {
  const fitted = useLightboxFit(
    natural.w,
    natural.h,
    LIGHTBOX_HEADER_H + (isVideo ? PLAYER_CONTROLS_H : 0),
  );

  if (fitted.cover) {
    const coverStyle = {
      width: "100vw",
      height: "100dvh",
      objectFit: "cover" as const,
      display: "block" as const,
    };
    return isVideo ? (
      <VideoPlayer src={url} mediaStyle={coverStyle} controlsOverlay />
    ) : (
      <Image src={url} alt={mime} style={coverStyle} />
    );
  }

  return (
    <Center style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {isVideo ? (
        <div style={{ width: fitted.width, maxWidth: "100%" }}>
          <VideoPlayer
            src={url}
            mediaStyle={{ width: "100%", display: "block", backgroundColor: "black" }}
          />
        </div>
      ) : (
        <Image
          src={url}
          alt={mime}
          fit="contain"
          style={{ width: fitted.width, height: fitted.height }}
        />
      )}
    </Center>
  );
}

export function MediaPreview({ attachment, kind = "private", context }: MediaPreviewProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Telegram-style lightbox: thumbnail click opens the image fullscreen,
  // X / backdrop-click / Escape closes it back to the chat.
  const [lightbox, setLightbox] = useState(false);
  const fileName = `file-${attachment.id}.${attachment.mime_type.split("/")[1] ?? "bin"}`;

  const isImage = attachment.mime_type.startsWith("image/");
  const isVideo = attachment.mime_type.startsWith("video/");
  const downloadFn = kind === "private" ? downloadAndDecryptPrivate : downloadAndDecryptGroup;
  // Known after the thumbnail video fires `loadedmetadata`; shown as
  // an overlay badge and inside the player.
  const [duration, setDuration] = useState(0);

  // Whether the vault peek settled. The explicit load button renders
  // only after a negative peek — stored bytes must appear with no click.
  const [checked, setChecked] = useState(false);
  // Intrinsic media size for the fullscreen fit policy (filled by the
  // thumbnail's load/metadata events; zeros until known).
  const [natural, setNatural] = useState({ w: 0, h: 0 });

  // Revoke through the cache owner so the entry is evicted too:
  // revoking the URL alone would leave a dead `blob:` URL in
  // `blobCache`, served stale on the next mount (broken image).
  useEffect(() => {
    return () => {
      revokeBlobUrl(attachment.id);
    };
  }, [attachment.id]);

  // Auto-render from local storage: vault hit (RAM, then ChaCha file)
  // needs no network and no user gesture. Miss → fall through to the
  // explicit load button below.
  useEffect(() => {
    let cancelled = false;
    setChecked(false);
    void peekVaultMedia(attachment.id).then((hit) => {
      if (cancelled) return;
      if (hit !== undefined) {
        setUrl(hit.url);
      }
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.id]);

  async function handleClick() {
    if (url || loading) return;

    setLoading(true);
    setError(null);

    try {
      const { url: blobUrl } = await downloadFn(attachment.id, context);
      setUrl(blobUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  if (loading)
    return (
      <Center mih={120}>
        <Loader />
      </Center>
    );
  if (error)
    return (
      <Text c="red" size="sm">
        {error}
      </Text>
    );

  if ((isImage || isVideo) && url) {
    return (
      <>
        <Box
          role="button"
          tabIndex={0}
          aria-label={t("media.openFullscreen", { defaultValue: "Open fullscreen" })}
          onClick={() => setLightbox(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setLightbox(true);
          }}
          style={{ cursor: "zoom-in", maxWidth: THUMB_MAX_W }}
        >
          {isVideo ? (
            <Box style={{ position: "relative" }}>
              <video
                src={url}
                preload="metadata"
                muted
                playsInline
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration);
                  setNatural({
                    w: e.currentTarget.videoWidth,
                    h: e.currentTarget.videoHeight,
                  });
                }}
                style={{ width: "100%", maxHeight: THUMB_MAX_H, backgroundColor: "black" }}
              />
              <Center
                style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.25)" }}
              >
                <ActionIcon variant="filled" size="xl" radius="xl" aria-hidden tabIndex={-1}>
                  <IconPlayerPlay size={20} />
                </ActionIcon>
              </Center>
              {duration > 0 && (
                <Text
                  size="xs"
                  c="white"
                  style={{
                    position: "absolute",
                    right: 6,
                    bottom: 6,
                    backgroundColor: "rgba(0,0,0,0.65)",
                    borderRadius: 4,
                    padding: "0 4px",
                  }}
                >
                  {formatMediaTime(duration)}
                </Text>
              )}
            </Box>
          ) : (
            <AspectRatio ratio={4 / 3} maw={THUMB_MAX_W} mah={THUMB_MAX_H}>
              <Image
                src={url}
                alt={attachment.mime_type}
                radius="md"
                fit="contain"
                onLoad={(e) => {
                  setNatural({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  });
                }}
              />
            </AspectRatio>
          )}
        </Box>
        <Modal
          opened={lightbox}
          onClose={() => setLightbox(false)}
          fullScreen
          withCloseButton={false}
          styles={{
            content: {
              height: "100dvh",
              maxHeight: "100dvh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            },
            body: {
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              padding: 0,
            },
          }}
        >
          <Group justify="space-between" mb={0} px="sm" pt="xs" style={{ flexShrink: 0 }}>
            <Text size="sm" c="dimmed">
              {attachment.mime_type}
            </Text>
            <Group gap="xs">
              <Tooltip label="Download">
                <ActionIcon
                  component="a"
                  href={url}
                  download={fileName}
                  variant="subtle"
                  size="sm"
                  aria-label="Download"
                >
                  <IconDownload size={14} />
                </ActionIcon>
              </Tooltip>
              <CloseButton
                onClick={() => setLightbox(false)}
                aria-label={t("common.close", { defaultValue: "Close" })}
              />
            </Group>
          </Group>
          <LightboxBody isVideo={isVideo} url={url} mime={attachment.mime_type} natural={natural} />
        </Modal>
      </>
    );
  }

  return (
    <Paper withBorder p="sm" maw={300}>
      <Group>
        {isVideo ? <IconPlayerPlay size={24} /> : <IconFile size={24} />}
        <div style={{ flex: 1 }}>
          <Text size="sm" fw={500}>
            {attachment.mime_type}
          </Text>
          <Text size="xs" c="dimmed">
            {(attachment.file_size / 1024).toFixed(1)} KB
          </Text>
        </div>
        {url ? (
          <Button
            component="a"
            href={url}
            download={fileName}
            leftSection={<IconDownload size={16} />}
          >
            Download
          </Button>
        ) : (
          checked && (
            <Button onClick={() => void handleClick()} variant="light">
              {t("media.load")}
            </Button>
          )
        )}
      </Group>
    </Paper>
  );
}
