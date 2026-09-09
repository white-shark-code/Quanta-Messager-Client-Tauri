import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { AspectRatio, Button, Center, Group, Image, Loader, Paper, Text, } from "@mantine/core";
import { IconDownload, IconFile } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { downloadAndDecryptGroup, downloadAndDecryptPrivate, } from "../decrypt";
export function MediaPreview({ attachment, kind = "private", }) {
    const { t } = useTranslation();
    const [url, setUrl] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const isImage = attachment.mime_type.startsWith("image/");
    const downloadFn = kind === "private" ? downloadAndDecryptPrivate : downloadAndDecryptGroup;
    useEffect(() => {
        return () => {
            if (url) {
                URL.revokeObjectURL(url);
            }
        };
    }, [url]);
    async function handleClick() {
        if (url || loading)
            return;
        setLoading(true);
        setError(null);
        try {
            const { url: blobUrl } = await downloadFn(attachment.id);
            setUrl(blobUrl);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load");
        }
        finally {
            setLoading(false);
        }
    }
    if (loading)
        return _jsx(Center, { mih: 120, children: _jsx(Loader, {}) });
    if (error)
        return _jsx(Text, { c: "red", size: "sm", children: error });
    if (isImage && url) {
        return (_jsx(AspectRatio, { ratio: 4 / 3, maw: 300, children: _jsx(Image, { src: url, alt: attachment.mime_type, radius: "md", fit: "contain" }) }));
    }
    return (_jsx(Paper, { withBorder: true, p: "sm", maw: 300, children: _jsxs(Group, { children: [_jsx(IconFile, { size: 24 }), _jsxs("div", { style: { flex: 1 }, children: [_jsx(Text, { size: "sm", fw: 500, children: attachment.mime_type }), _jsxs(Text, { size: "xs", c: "dimmed", children: [(attachment.file_size / 1024).toFixed(1), " KB"] })] }), url ? (_jsx(Button, { component: "a", href: url, download: `file-${attachment.id}.${attachment.mime_type.split("/")[1] ?? "bin"}`, leftSection: _jsx(IconDownload, { size: 16 }), children: "Download" })) : (_jsx(Button, { onClick: handleClick, variant: "light", children: t("media.load") }))] }) }));
}
