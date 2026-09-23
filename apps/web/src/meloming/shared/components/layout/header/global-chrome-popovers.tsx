"use client";

import type { MelomingUser } from "@/meloming/shared/lib/auth-runtime";
import type {
  ServiceCategory,
  ServiceId,
} from "@/meloming/shared/lib/service-routes";
import { loadGlobalChromeRemote } from "@/meloming/shared/lib/mf-runtime";
import { UserProfileMenu } from "@/meloming/shared/components/layout/user-profile-menu";
import {
  ServiceLauncher,
  type ServiceLauncherVariant,
} from "@/meloming/shared/components/layout/service-launcher";
import { useTheme } from "next-themes";
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

type ThemePreference = "system" | "light" | "dark";

type ProfilePopoverProps = {
  user: MelomingUser | null;
  loading: boolean;
  loginHref: string;
  accountHref?: string;
  accountLabel?: string;
  extraItems?: Array<{
    href: string;
    label: string;
    icon?: "external" | "products";
  }>;
  onLogout: () => void;
  compact?: boolean;
  themePreference?: ThemePreference;
  onThemePreferenceChange?: (preference: ThemePreference) => void;
};

type ServicePopoverProps = {
  activeService: ServiceId;
  logoSrc: string;
  categories?: ServiceCategory[];
  variant?: ServiceLauncherVariant;
};

const ProfilePopover = lazy<ComponentType<ProfilePopoverProps>>(() =>
  loadGlobalChromeRemote("global_chrome/ProfilePopover").then((module) => ({
    default: (module as { ProfilePopover: ComponentType<ProfilePopoverProps> })
      .ProfilePopover,
  })),
);

const ServicePopover = lazy<ComponentType<ServicePopoverProps>>(() =>
  loadGlobalChromeRemote("global_chrome/ServicePopover").then((module) => ({
    default: (module as { ServicePopover: ComponentType<ServicePopoverProps> })
      .ServicePopover,
  })),
);

class RemoteChromeErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // Keep the local header actions available while the remote is unavailable.
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export function RemoteProfilePopover(
  props: Omit<ProfilePopoverProps, "themePreference" | "onThemePreferenceChange">,
) {
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();
  const themePreference: ThemePreference =
    theme === "light" || theme === "dark" ? theme : "system";
  const fallback = <UserProfileMenu {...props} />;

  if (!mounted || props.loading || !props.user) return fallback;

  return (
    <RemoteChromeErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <ProfilePopover
          {...props}
          themePreference={themePreference}
          onThemePreferenceChange={setTheme}
        />
      </Suspense>
    </RemoteChromeErrorBoundary>
  );
}

export function RemoteServicePopover({
  logoSrc = "",
  ...props
}: Omit<ServicePopoverProps, "logoSrc"> & { logoSrc?: string }) {
  const mounted = useMounted();
  const fallback = <ServiceLauncher {...props} logoSrc={logoSrc} />;

  if (!mounted) return fallback;

  return (
    <RemoteChromeErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <ServicePopover {...props} logoSrc={logoSrc} />
      </Suspense>
    </RemoteChromeErrorBoundary>
  );
}

function useMounted() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return mounted;
}
