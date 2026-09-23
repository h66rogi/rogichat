'use client';
import type { ReactNode } from 'react';
import { useAuth } from '@/meloming/domains/auth/hooks/use-auth';
import { GlobalHeader } from '@/meloming/shared/components/layout/global-header';
import { RemoteProfilePopover } from '@/meloming/shared/components/layout/header/global-chrome-popovers';
import { routes } from '@/meloming/shared/lib/service-routes';
import type { MenuViewer } from '../menu/menu-types';
import type { ProfileSummary } from '../auth/get-menu-viewer';

type Props = {
  viewer: MenuViewer;
  profile?: ProfileSummary;
  footer?: ReactNode;
  children: ReactNode;
};

function PortalHeader() {
  const auth = useAuth();
  const returnTo = typeof window !== 'undefined' ? window.location.href : '/';

  return (
    <GlobalHeader
      activeService="portal"
      wordmarkSrc="/logo/meloming-logo-full.png"
      wordmarkAlt="멜로밍"
      logoVariant="wordmark"
      brandPrefix={null}
      title=""
      userSlot={
        <>
          <RemoteProfilePopover
            user={auth.user ?? null}
            loading={auth.isLoading}
            loginHref={routes.account.login(returnTo)}
            accountHref={routes.id.security()}
            accountLabel="통합 ID · 계정 및 보안"
            extraItems={[
              {
                href: routes.account.home(),
                label: "멜로밍 마이페이지",
                icon: "external",
              },
            ]}
            onLogout={() => {
              void auth.logout();
            }}
          />
        </>
      }
    />
  );
}

export function NewShell({ footer, children }: Props) {
  return (
    <div
      data-site-sticky-context="flowing-header"
      className="min-h-screen flex flex-col"
    >
      <PortalHeader />
      <div
        className="flex-1 min-w-0 flex flex-col"
        style={{ paddingRight: 'var(--shell-right-rail, 0px)' }}
      >
        <main className="flex-1 min-w-0">
          <div className="min-w-0">{children}</div>
        </main>
        {footer}
      </div>
    </div>
  );
}
