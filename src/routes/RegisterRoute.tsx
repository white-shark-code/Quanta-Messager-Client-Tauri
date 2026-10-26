/**
 * Registration route, gated by the server's registration mode
 * (`/meta → registration_mode`):
 *
 * - "closed" → an informational card with a sign-in link, no form.
 * - "open"   → the bare form; on success `useRegister` navigates to
 *   /setup-key.
 * - "approval" (also the fallback while meta is loading) → the form with
 *   an approval note; on success this component renders the "pending"
 *   screen instead of the form — `useRegister` deliberately performs no
 *   navigation and no session writes in approval mode (the account is
 *   created INACTIVE until an admin approves it).
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Anchor,
  Button,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useTranslation } from "react-i18next";

import { useRegister } from "@/features/auth/queries";
import { describeRegisterError, validateRegisterForm } from "@/features/auth/registerFlow";
import { resolveRegistrationMode } from "@/features/meta/api";
import { useServerMeta } from "@/features/meta/queries";
import { toUserMessage } from "@/infra/error";
import { BrandLockup } from "@/ui/components/BrandLogo";

export function RegisterRoute(): JSX.Element {
  const { t } = useTranslation();
  const meta = useServerMeta();
  const mode = resolveRegistrationMode(meta.data);
  const register = useRegister(mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(): void {
    setValidationError(null);
    const clientError = validateRegisterForm(email.trim(), password, confirmPassword);
    if (clientError !== null) {
      setValidationError(t(clientError));
      return;
    }
    // Navigation after success is handled by `useRegister.onSuccess` —
    // either to /setup-key (open mode) or deliberately nowhere (approval
    // mode, where this component renders the pending screen).
    void register.mutateAsync({ email: email.trim(), password });
  }

  const hintKey = register.error !== null ? describeRegisterError(register.error) : null;
  const mutationError =
    register.error !== null
      ? hintKey !== null
        ? t(hintKey)
        : toUserMessage(register.error)
      : null;

  if (meta.isLoading) {
    return (
      <Stack align="center" mt={120}>
        <Loader />
      </Stack>
    );
  }

  if (mode === "closed") {
    return (
      <Paper p="xl" maw={400} mx="auto" mt={80}>
        <Stack align="center" mb="lg">
          <BrandLockup size={40} />
        </Stack>
        <Title order={2} mb="md" ta="center">
          {t("auth.register.title")}
        </Title>
        <Stack>
          <Alert color="red">{t("auth.register.errors.closed")}</Alert>
          <Anchor component={Link} to="/login" ta="center">
            {t("auth.register.haveAccount")} {t("auth.register.loginLink")}
          </Anchor>
        </Stack>
      </Paper>
    );
  }

  // "approval" success: the account was created but stays INACTIVE until
  // an admin approves it — show the pending screen instead of the form.
  // No session writes / no auto-login happen here (useRegister is a
  // no-op in approval mode).
  const pending = register.isSuccess && mode === "approval";

  return (
    <Paper p="xl" maw={400} mx="auto" mt={80}>
      <Stack align="center" mb="lg">
        <BrandLockup size={40} />
      </Stack>
      <Title order={2} mb="md" ta="center">
        {t(pending ? "auth.register.pendingTitle" : "auth.register.title")}
      </Title>
      {pending ? (
        <Stack>
          <Text>{t("auth.register.pendingText")}</Text>
          <Anchor component={Link} to="/login" ta="center">
            {t("auth.register.pendingBackToLogin")}
          </Anchor>
        </Stack>
      ) : (
        <Stack>
          {mode === "approval" && <Alert color="blue">{t("auth.register.approvalNote")}</Alert>}
          <TextInput
            label={t("auth.register.email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
          />
          <PasswordInput
            label={t("auth.register.password")}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
          />
          <PasswordInput
            label={t("auth.register.confirmPassword")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            required
          />
          {validationError !== null && <Alert color="red">{validationError}</Alert>}
          {mutationError !== null && <Alert color="red">{mutationError}</Alert>}
          <Button onClick={handleSubmit} loading={register.isPending}>
            {register.isPending ? t("auth.register.submitting") : t("auth.register.submit")}
          </Button>
          <Anchor component={Link} to="/login" ta="center">
            {t("auth.register.haveAccount")} {t("auth.register.loginLink")}
          </Anchor>
        </Stack>
      )}
    </Paper>
  );
}
