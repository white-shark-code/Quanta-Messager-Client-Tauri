import { useEffect, useState } from "react"
import {
  AspectRatio,
  Button,
  Center,
  FileButton,
  Group,
  Image,
  Loader,
  Paper,
  Text,
} from "@mantine/core"
import { IconDownload, IconFile } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import {
  downloadAndDecryptGroup,
  downloadAndDecryptPrivate,
} from "../decrypt"
import type { MediaAttachment } from "../model"

interface MediaPreviewProps {
  attachment: MediaAttachment
  kind?: "private" | "group"
}

export function MediaPreview({
  attachment,
  kind = "private",
}: MediaPreviewProps) {
  const { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isImage = attachment.mime_type.startsWith("image/")
  const downloadFn =
    kind === "private" ? downloadAndDecryptPrivate : downloadAndDecryptGroup

  useEffect(() => {
    return () => {
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
  }, [url])

  async function handleClick() {
    if (url || loading) return

    setLoading(true)
    setError(null)

    try {
      const { url: blobUrl } = await downloadFn(attachment.id)
      setUrl(blobUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <Center mih={120}><Loader /></Center>
  if (error) return <Text c="red" size="sm">{error}</Text>

  if (isImage && url) {
    return (
      <AspectRatio ratio={4 / 3} maw={300}>
        <Image src={url} alt={attachment.mime_type} radius="md" fit="contain" />
      </AspectRatio>
    )
  }

  return (
    <Paper withBorder p="sm" maw={300}>
      <Group>
        <IconFile size={24} />
        <div style={{ flex: 1 }}>
          <Text size="sm" fw={500}>{attachment.mime_type}</Text>
          <Text size="xs" c="dimmed">
            {(attachment.file_size / 1024).toFixed(1)} KB
          </Text>
        </div>
        {url ? (
          <Button
            component="a"
            href={url}
            download={`file-${attachment.id}.${attachment.mime_type.split("/")[1] ?? "bin"}`}
            leftSection={<IconDownload size={16} />}
          >
            Download
          </Button>
        ) : (
          <Button onClick={handleClick} variant="light">{t("media.load")}</Button>
        )}
      </Group>
    </Paper>
  )
}
