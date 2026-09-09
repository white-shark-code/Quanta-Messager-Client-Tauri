import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Route to create a new private (1-to-1) dialog by entering the peer user's UUID.
 *
 * MVP intentionally has no email/username search — the backend exposes no
 * directory endpoint (see `report_for_backend/01`), so the user must paste
 * a UUID obtained out of band. Client-side validates UUID format and
 * blocks self-chat before sending the request.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useCreatePrivateChat } from "@/features/chats/queries";
import { useSessionStore } from "@/features/auth/sessionStore";
import { toUserMessage } from "@/infra/error";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function NewChatRoute() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const createChat = useCreatePrivateChat();
    const currentUser = useSessionStore((s) => s.user);
    const [name, setName] = useState("");
    const [peerUuid, setPeerUuid] = useState("");
    const [validationError, setValidationError] = useState(null);
    async function handleSubmit() {
        setValidationError(null);
        if (currentUser === null) {
            setValidationError(t("chats.newChat.errors.notLoggedIn"));
            return;
        }
        if (peerUuid === currentUser.id) {
            setValidationError(t("chats.newChat.errors.selfChat"));
            return;
        }
        if (!UUID_REGEX.test(peerUuid)) {
            setValidationError(t("chats.newChat.errors.invalidUuid"));
            return;
        }
        try {
            const chat = await createChat.mutateAsync({
                name: name.length > 0 ? name : `Chat with ${peerUuid.slice(0, 8)}`,
                user: peerUuid,
            });
            navigate(`/chats/${chat.id}`, { replace: true });
        }
        catch {
            // mutation.error will surface in the JSX below
        }
    }
    const displayError = validationError ?? (createChat.error !== null ? toUserMessage(createChat.error) : null);
    return (_jsxs(Paper, { p: "md", maw: 500, mx: "auto", mt: 40, children: [_jsx(Title, { order: 2, mb: "md", children: t("chats.newChat.title") }), _jsxs(Stack, { children: [_jsx(Text, { size: "sm", c: "dimmed", children: t("chats.newChat.description") }), _jsx(TextInput, { label: t("chats.newChat.peerUuidLabel"), placeholder: t("chats.newChat.peerUuidPlaceholder"), value: peerUuid, onChange: (e) => setPeerUuid(e.currentTarget.value), required: true }), _jsx(TextInput, { label: t("chats.newChat.chatNameLabel"), placeholder: t("chats.newChat.chatNamePlaceholder"), value: name, onChange: (e) => setName(e.currentTarget.value) }), displayError !== null && _jsx(Alert, { color: "red", children: displayError }), _jsx(Button, { onClick: () => void handleSubmit(), loading: createChat.isPending, children: t("chats.newChat.submit") })] })] }));
}
