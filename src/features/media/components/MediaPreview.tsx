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
import { IconDownload, IconFile } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  downloadAndDecryptGroup,
  downloadAndDecryptPrivate,
  peekVaultMedia,
  revokeBlobUrl,
} from "../decrypt";
import type { MediaVaultContext } from "../decrypt";
import type { MediaAttachment } from "../model";

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
  const downloadFn = kind === "private" ? downloadAndDecryptPrivate : downloadAndDecryptGroup;

  // Whether the vault peek settled. The explicit load button renders
  // only after a negative peek — stored bytes must appear with no click.
  const [checked, setChecked] = useState(false);

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

  if (isImage && url) {
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
          <AspectRatio ratio={4 / 3} maw={THUMB_MAX_W} mah={THUMB_MAX_H}>
            <Image src={url} alt={attachment.mime_type} radius="md" fit="contain" />
          </AspectRatio>
        </Box>
        <Modal
          opened={lightbox}
          onClose={() => setLightbox(false)}
          fullScreen
          withCloseButton={false}
          styles={{ body: { height: "calc(100% - 52px)" } }}
        >
          <Group justify="space-between" mb="xs">
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
          <Center h="100%">
            <Image
              src={url}
              alt={attachment.mime_type}
              fit="contain"
              style={{ maxWidth: "100%", maxHeight: "100%" }}
            />
          </Center>
        </Modal>
      </>
    );
  }

  return (
    <Paper withBorder p="sm" maw={300}>
      <Group>
        <IconFile size={24} />
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
