'use client';

import {
  type CSSProperties,
  type ReactNode,
} from 'react';
import { SidebarProvider } from '@/meloming/shared/components/ui/sidebar';
import { ManagementSidebarWrapper } from '@/meloming/shared/components/layout/management-sidebar-wrapper';
import { GlobalThinHeader } from '@/meloming/shared/components/layout/global-thin-header';
import { ManageMobileTopBar } from './ManageMobileTopBar';
import type { ManagementSection } from '@/meloming/domains/channel/components/management/types';
import type { ProfileSummary } from '../auth/get-menu-viewer';

const MANAGE_SIDEBAR_WIDTH = '19rem';
const CARD_GAP_PX = 8;
const THIN_HEADER_HEIGHT = 42;
const HEADER_PADDING = 4;
const HEADER_AREA_HEIGHT = THIN_HEADER_HEIGHT + HEADER_PADDING;
const MOBILE_TOP_BAR_HEIGHT = 64;
const TABLET_BREAK = 768;

type Props = {
  profile?: ProfileSummary;
  user: string;
  activeSection: ManagementSection;
  footer: ReactNode;
  children: ReactNode;
};

export function ManageShell({
  user,
  activeSection,
  footer,
  children,
}: Props) {
  const desktopUI = (
    <SidebarProvider
      open={true}
      onOpenChange={() => {}}
      className="isolate"
      style={
        {
          '--sidebar-width': MANAGE_SIDEBAR_WIDTH,
          '--card-gap': `${CARD_GAP_PX}px`,
          '--site-sticky-top': `calc(var(--meloming-top-notice-height) + ${HEADER_AREA_HEIGHT}px)`,
          '--sidebar': 'var(--background)',
        } as CSSProperties
      }
    >
      <div
        data-site-sticky-context="fixed-header"
        className="flex w-full min-h-svh flex-col bg-muted"
      >
        <div aria-hidden className="pointer-events-none">
          <div
            className="fixed top-0 left-0 right-0 bg-muted z-50"
            style={{ height: `${HEADER_AREA_HEIGHT}px` }}
          />
          <div
            className="fixed bottom-0 left-0 right-0 bg-muted z-50"
            style={{ height: 'var(--card-gap)' }}
          />
          <div
            className="fixed inset-y-0 left-0 bg-muted z-50"
            style={{ width: 'var(--card-gap)' }}
          />
          <div
            className="fixed inset-y-0 right-0 bg-muted z-50"
            style={{ width: 'var(--card-gap)' }}
          />
          <div
            className="fixed rounded-xl border border-border shadow-sm z-50"
            style={{
              top: `${HEADER_AREA_HEIGHT}px`,
              bottom: 'var(--card-gap)',
              left: 'var(--card-gap)',
              right: 'var(--card-gap)',
            }}
          />
        </div>

        <div className="sticky top-[var(--meloming-top-notice-height)] z-[60] bg-muted py-0.5">
          <GlobalThinHeader
            logoSrc="/icons/rogichat-icon.svg"
            logoAlt="로기챗"
            userSlot={<a href="/settings" className="text-sm text-foreground">설정</a>}
          />
        </div>

        <div className="flex flex-1 w-full pb-[var(--card-gap)] px-[var(--card-gap)]">
          <div className="relative flex flex-1 w-full bg-background rounded-xl">
            <ManagementSidebarWrapper user={user} activeSection={activeSection} />
            <div className="flex-1 min-w-0 flex flex-col">
              <main className="flex-1 min-w-0">{children}</main>
              <div className="overflow-hidden rounded-br-xl">{footer}</div>
            </div>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );

  const mobileUI = (
    <SidebarProvider
      open={true}
      onOpenChange={() => {}}
      className="isolate"
      style={
        {
          '--sidebar-width': MANAGE_SIDEBAR_WIDTH,
          '--site-sticky-top': `calc(var(--meloming-top-notice-height) + ${MOBILE_TOP_BAR_HEIGHT}px)`,
          '--sidebar': 'var(--background)',
        } as CSSProperties
      }
    >
      <div
        data-site-sticky-context="fixed-header"
        className="flex w-full min-h-svh flex-col"
      >
        <div className="fixed top-[var(--meloming-top-notice-height)] left-0 right-0 z-40">
          <ManageMobileTopBar user={user} />
        </div>

        <div className="flex-1" style={{
            paddingTop: `calc(var(--meloming-top-notice-height) + ${MOBILE_TOP_BAR_HEIGHT}px)`,
          }}>
          <ManagementSidebarWrapper user={user} activeSection={activeSection} />
          <main>{children}</main>
          {footer}
        </div>
      </div>
    </SidebarProvider>
  );

  return (
    <>
      <div className="manage-desktop" style={{ display: 'contents' }}>{desktopUI}</div>
      <div className="manage-mobile" style={{ display: 'none' }}>{mobileUI}</div>
      <style dangerouslySetInnerHTML={{ __html: `
        @media (max-width: ${TABLET_BREAK - 1}px) {
          .manage-desktop { display: none !important; }
          .manage-mobile  { display: contents !important; }
        }
      ` }} />
    </>
  );
}
