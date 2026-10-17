import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { ActionIcon, Alert, Button, Group, Paper, Text, Textarea, Tooltip } from "@mantine/core";
import {
  IconAlertCircle,
  IconLock,
  IconPaperclip,
  IconSend,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useKeyringStore } from "@/features/keyring/keyringStore";
import { useSessionStore } from "@/features/auth/sessionStore";
import {
  fileNameFromPath,
  hasKeystore,
  isTauriRuntime,
  pickFiles,
  readPickedFileBytes,
} from "@/infra/tauriBridge";
import { toUserMessage } from "@/infra/error";
import { MAX_MEDIA_SIZE_BYTES } from "@/features/media/constants";
import { encryptAndUploadGroup, encryptAndUploadPrivate } from "@/features/media/pipeline";

import { useComposerStore } from "../composerStore";
import { useSendGroupMessage, useSendPrivateMessage } from "../mutations";
import { useReplyStore } from "../replyStore";

export interface ComposerProps {
  chatId: string;
  kind?: "private" | "group";
  /**
   * ASCII-armored PGP public key of the recipient (peer for 1:1, group
   * for group chat). When set, the message is encrypted to this
   * recipient so they can actually decrypt it. When omitted, the
   * message falls back to encrypting to the local user (notes-to-self).
   */
  peerPublicKeyArmored?: string | null;
  /**
   * When set, the composer is read-only: the textarea and send button
   * are disabled, the textarea placeholder is replaced with `disabledReason`,
   * and a yellow Alert mirrors the message below the input.
   *
   * Use this for "soft" disables — e.g. the recipient has no PGP key yet —
   * where the user should still see the chat and understand why they
   * can't send. The hard "you have no keys" block above (rendered when
   * `hasKeys` is false) is a stronger, separate state.
   */
  disabledReason?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  pdf: "application/pdf",
  txt: "text/plain",
  json: "application/json",
};

/** Guess a MIME type from a file path extension (native dialog gives no MIME). */
function guessMime(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  const mime = EXT_MIME[name.slice(dot + 1).toLowerCase()];
  return mime ?? "";
}

export function Composer({
  chatId,
  kind = "private",
  disabledReason,
  peerPublicKeyArmored,
}: ComposerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const text = useComposerStore((s) => s.drafts[chatId]?.text ?? "");
  const mediaFiles = useComposerStore((s) => s.drafts[chatId]?.mediaFiles ?? []);
  const setText = useComposerStore((s) => s.setText);
  const addMedia = useComposerStore((s) => s.addMedia);
  const updateMediaStatus = useComposerStore((s) => s.updateMediaStatus);
  const removeMedia = useComposerStore((s) => s.removeMedia);
  const clearDraft = useComposerStore((s) => s.clearDraft);
  const sendPrivate = useSendPrivateMessage(chatId, peerPublicKeyArmored);
  const sendGroup = useSendGroupMessage(chatId, peerPublicKeyArmored);
  const send = kind === "private" ? sendPrivate : sendGroup;
  const reply = useReplyStore((s) => s.replies[chatId]);
  const clearReply = useReplyStore((s) => s.clearReply);
  const hasKeys = useKeyringStore((s) => s.privateKey !== null);
  const currentUserId = useSessionStore((s) => s.user?.id);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Raw blobs keyed `${chatId}:${mediaId}` — the store keeps metadata only. */
  const pendingBlobsRef = useRef(new Map<string, Blob>());
  const [sendError, setSendError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [keystoreOnDisk, setKeystoreOnDisk] = useState<boolean | null>(null);

  useEffect(() => {
    if (currentUserId === undefined) return;
    void hasKeystore(currentUserId).then(setKeystoreOnDisk);
  }, [currentUserId]);

  function handleTextChange(value: string): void {
    setText(chatId, value);
    if (sendError !== null) setSendError(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function addBlobs(blobs: { blob: Blob; name: string }[]): void {
    for (const { blob, name } of blobs) {
      if (blob.size > MAX_MEDIA_SIZE_BYTES) {
        setSendError(t("messages.composer.fileTooLarge", { name }));
        continue;
      }
      if (blob.size === 0) {
        setSendError(t("messages.composer.fileEmpty", { name }));
        continue;
      }
      const id = crypto.randomUUID();
      const fileName = name.length > 0 ? name : t("messages.composer.unnamedFile");
      addMedia(chatId, {
        id,
        name: fileName,
        size: blob.size,
        mimeType: blob.type !== "" ? blob.type : guessMime(fileName),
        status: "pending",
      });
      pendingBlobsRef.current.set(`${chatId}:${id}`, blob);
    }
  }

  function handleRemoveMedia(mediaId: string): void {
    pendingBlobsRef.current.delete(`${chatId}:${mediaId}`);
    removeMedia(chatId, mediaId);
  }

  async function handleAttach(): Promise<void> {
    if (disabledReason !== undefined) return;
    if (isTauriRuntime()) {
      try {
        const paths = await pickFiles(true);
        if (paths === null) return;
        const blobs: { blob: Blob; name: string }[] = [];
        for (const p of paths) {
          try {
            const bytes = await readPickedFileBytes(p);
            const name = fileNameFromPath(p);
            const copy = new Uint8Array(bytes);
            blobs.push({
              blob: new File([copy], name, { type: guessMime(name) }),
              name,
            });
          } catch (e) {
            setSendError(toUserMessage(e));
          }
        }
        if (blobs.length > 0) addBlobs(blobs);
      } catch (e) {
        setSendError(toUserMessage(e));
      }
      return;
    }
    fileInputRef.current?.click();
  }

  function handleFileInput(files: FileList | null): void {
    if (files === null) return;
    addBlobs(Array.from(files, (f) => ({ blob: f, name: f.name })));
    // Reset so picking the same file twice still fires `onChange`.
    if (fileInputRef.current !== null) fileInputRef.current.value = "";
  }

  function handlePaste(e: ClipboardEvent): void {
    const files: File[] = [];
    const seen = new Set<string>();
    const clipboard = e.clipboardData;
    if (clipboard !== null) {
      for (const f of Array.from(clipboard.files)) {
        files.push(f);
        seen.add(`${f.name}:${f.size}:${f.lastModified}`);
      }
      for (const item of Array.from(clipboard.items)) {
        if (item.kind !== "file") continue;
        const f = item.getAsFile();
        if (f === null) continue;
        const key = `${f.name}:${f.size}:${f.lastModified}`;
        if (!seen.has(key)) {
          files.push(f);
          seen.add(key);
        }
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    addBlobs(files.map((f, i) => ({ blob: f, name: f.name !== "" ? f.name : `pasted-${i + 1}` })));
  }

  function handleDragOver(e: DragEvent): void {
    if (disabledReason !== undefined) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }

  function handleDrop(e: DragEvent): void {
    setDragging(false);
    if (disabledReason !== undefined) return;
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    addBlobs(
      Array.from(e.dataTransfer.files, (f) => ({
        blob: f,
        name: f.name !== "" ? f.name : t("messages.composer.unnamedFile"),
      })),
    );
  }

  async function handleSend(): Promise<void> {
    const draft = useComposerStore.getState().drafts[chatId];
    const media = draft?.mediaFiles ?? [];
    if (!text.trim() && media.length === 0) return;
    if (send.isPending || uploading) return;
    setSendError(null);
    const currentText = text;
    try {
      let media_ids: string[] | undefined;
      const pending = media.filter((m) => m.status === "pending" || m.status === "failed");
      if (pending.length > 0) {
        setUploading(true);
        const upload = kind === "private" ? encryptAndUploadPrivate : encryptAndUploadGroup;
        const ids: string[] = [];
        for (const m of pending) {
          const blob = pendingBlobsRef.current.get(`${chatId}:${m.id}`);
          if (blob === undefined) {
            updateMediaStatus(chatId, m.id, "failed");
            throw new Error(t("messages.composer.attachmentMissing", { name: m.name }));
          }
          try {
            updateMediaStatus(chatId, m.id, "encrypted", 50);
            const up = await upload(blob, chatId, {
              ...(peerPublicKeyArmored != null && peerPublicKeyArmored !== ""
                ? { peerPublicKeyArmored }
                : {}),
            });
            updateMediaStatus(chatId, m.id, "uploaded", 100);
            ids.push(up.id);
          } catch (e) {
            updateMediaStatus(chatId, m.id, "failed");
            throw e;
          }
        }
        setUploading(false);
        media_ids = ids;
      }
      await send.mutateAsync({
        chatId,
        text: currentText,
        ...(reply !== undefined ? { replyTo: { id: reply.id } } : {}),
        ...(media_ids !== undefined && media_ids.length > 0 ? { media_ids } : {}),
      });
      for (const m of media) {
        pendingBlobsRef.current.delete(`${chatId}:${m.id}`);
      }
      clearDraft(chatId);
      clearReply(chatId);
      textareaRef.current?.focus();
    } catch (e) {
      setUploading(false);
      // Keep the message visible until the user types or dismisses it.
      setSendError(toUserMessage(e));
    }
  }

  function openUnlockModal(): void {
    window.dispatchEvent(new Event("unlock-modal:open"));
  }

  if (!hasKeys) {
    return (
      <Paper p="md" withBorder>
        <Group justify="space-between" wrap="wrap">
          <Group>
            <IconLock size={16} />
            <span>{t("messages.composer.unlockFirst")}</span>
          </Group>
          <Group gap="xs">
            {keystoreOnDisk === true && (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconLock size={14} />}
                onClick={openUnlockModal}
              >
                {t("messages.composer.unlockButton")}
              </Button>
            )}
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconSettings size={14} />}
              onClick={() => navigate("/create-keystore")}
            >
              {t("messages.composer.setupKeyButton")}
            </Button>
          </Group>
        </Group>
      </Paper>
    );
  }

  const canSend =
    disabledReason === undefined &&
    (text.trim().length > 0 || mediaFiles.length > 0) &&
    !send.isPending &&
    !uploading;

  return (
    <Paper
      p="sm"
      withBorder
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      style={
        dragging
          ? { outline: "2px dashed var(--mantine-color-blue-5)", outlineOffset: -2 }
          : undefined
      }
    >
      {reply !== undefined && (
        <Paper withBorder p="xs" mb="xs">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <div>
              <Text size="xs" c="dimmed">
                {t("messages.reply", { defaultValue: "Reply" })} · {reply.sender.slice(0, 8)}
              </Text>
              <Text size="sm" lineClamp={2}>
                {reply.preview.length > 0
                  ? reply.preview
                  : t("messages.originalUnavailable", {
                      defaultValue: "Original message unavailable",
                    })}
              </Text>
            </div>
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label={t("messages.replyCancel", { defaultValue: "Cancel reply" })}
              onClick={() => clearReply(chatId)}
            >
              <IconX size={14} />
            </ActionIcon>
          </Group>
        </Paper>
      )}
      {mediaFiles.length > 0 && (
        <Group gap="xs" mb="xs">
          {mediaFiles.map((m) => (
            <Paper key={m.id} withBorder p="xs">
              <Group gap="xs" wrap="nowrap">
                <div>
                  <Text size="xs" fw={500} lineClamp={1} maw={160}>
                    {m.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatBytes(m.size)} · {t(`messages.composer.mediaStatus.${m.status}`)}
                    {m.progress !== undefined ? ` ${m.progress}%` : ""}
                  </Text>
                </div>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  aria-label={t("messages.composer.removeAttachment")}
                  onClick={() => handleRemoveMedia(m.id)}
                  disabled={uploading}
                >
                  <IconX size={14} />
                </ActionIcon>
              </Group>
            </Paper>
          ))}
        </Group>
      )}
      {dragging && (
        <Text size="xs" c="dimmed" mb="xs">
          {t("messages.composer.dropHint")}
        </Text>
      )}
      <Group align="flex-end" gap="xs">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => handleFileInput(e.target.files)}
        />
        <Tooltip label={t("messages.composer.attach")}>
          <ActionIcon
            size="lg"
            variant="subtle"
            onClick={() => void handleAttach()}
            disabled={disabledReason !== undefined || uploading}
            aria-label={t("messages.composer.attach")}
          >
            <IconPaperclip size={18} />
          </ActionIcon>
        </Tooltip>
        <Textarea
          ref={textareaRef}
          placeholder={
            disabledReason !== undefined
              ? t("messages.composer.disabledPlaceholder")
              : t("messages.composer.placeholder")
          }
          value={text}
          onChange={(e) => handleTextChange(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          autosize
          minRows={1}
          maxRows={6}
          style={{ flex: 1 }}
          disabled={disabledReason !== undefined}
        />
        <Tooltip label={t("messages.composer.sendTooltip")}>
          <ActionIcon
            size="lg"
            variant="filled"
            onClick={() => void handleSend()}
            disabled={!canSend}
            loading={send.isPending || uploading}
          >
            <IconSend size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {sendError !== null && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={16} />}
          mt="xs"
          withCloseButton
          onClose={() => setSendError(null)}
        >
          {sendError}
        </Alert>
      )}
    </Paper>
  );
}
