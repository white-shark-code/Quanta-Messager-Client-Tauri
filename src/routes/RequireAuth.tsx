import { useEffect, useRef, useState, type ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useSessionStore } from "@/features/auth/sessionStore";
import { getOnboardingPending } from "@/features/auth/onboardingPending";
import { getLastUserId } from "@/features/secure-store/store";
import { hasKeystore } from "@/infra/tauriBridge";
import { BootSplash } from "@/ui/components/BootSplash";

const ONBOARDING_PATHS = ["/create-keystore", "/setup-key"];

export function RequireAuth({ children }: { children: ReactElement }) {
  const isUnlocked = useSessionStore((s) => s.isUnlocked);
  const user = useSessionStore((s) => s.user);
  const location = useLocation();
  const [hydrated, setHydrated] = useState(false);
  // undefined = still resolving, string = keystore owner, null = none.
  const [lastUserId, setLastUserId] = useState<string | null | undefined>(undefined);
  // Resume check for an unlocked-but-keyless session: null = unknown /
  // not applicable, boolean = "must resume generation".
  const [mustResume, setMustResume] = useState<boolean | null>(null);
  // Cache within one locked episode so re-renders don't re-hit the disk.
  // Reset when unlocked so the next lock re-resolves fresh.
  const cachedRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (isUnlocked) {
      cachedRef.current = undefined;
      setLastUserId(undefined);
      return;
    }
    if (cachedRef.current !== undefined) {
      setLastUserId(cachedRef.current);
      return;
    }
    let cancelled = false;
    void getLastUserId().then((userId) => {
      if (cancelled) return;
      cachedRef.current = userId;
      setLastUserId(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, isUnlocked]);

  // Unlocked but keyless with a pending onboarding flag: the user is
  // mid-onboarding (e.g. upload failed before Phase B) and must not
  // enter chats — bounce to generation instead. Onboarding pages
  // themselves are exempt to avoid a redirect loop.
  const onOnboardingPage = ONBOARDING_PATHS.some(
    (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
  );
  const pendingForUser =
    hydrated &&
    isUnlocked &&
    user !== null &&
    !onOnboardingPage &&
    getOnboardingPending()?.userId === user.id;
  const resumeUserId = pendingForUser && user !== null ? user.id : null;

  useEffect(() => {
    if (!pendingForUser || resumeUserId === null) {
      setMustResume(null);
      return;
    }
    let cancelled = false;
    setMustResume(null);
    void hasKeystore(resumeUserId).then((exists) => {
      if (cancelled) return;
      setMustResume(!exists);
    });
    return () => {
      cancelled = true;
    };
  }, [pendingForUser, resumeUserId]);

  if (!hydrated || (!isUnlocked && lastUserId === undefined)) {
    return <BootSplash />;
  }

  if (!isUnlocked) {
    if (lastUserId !== null && lastUserId !== undefined) {
      return (
        <Navigate
          to={`/unlock?userId=${encodeURIComponent(lastUserId)}`}
          state={{ from: location }}
          replace
        />
      );
    }
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (pendingForUser && resumeUserId !== null) {
    if (mustResume === null) {
      return <BootSplash />;
    }
    if (mustResume) {
      return (
        <Navigate
          to={`/create-keystore?userId=${encodeURIComponent(resumeUserId)}&resume=1`}
          state={{ from: location }}
          replace
        />
      );
    }
  }

  return children;
}
