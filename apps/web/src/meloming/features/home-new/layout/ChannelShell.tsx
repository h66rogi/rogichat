'use client';

import { type CSSProperties, type ReactNode } from 'react';
import { SidebarProvider } from '@/meloming/shared/components/ui/sidebar';
import { ChannelMenuSidebar } from '@/meloming/domains/channel/components/channel/channel-menu-sidebar';
import { GlobalThinHeader } from '@/meloming/shared/components/layout/global-thin-header';
import { HeaderProfileMenu } from '@/meloming/shared/components/layout/header-profile-menu';
import { ChannelMobileTopBar } from './ChannelMobileTopBar';
import type { ChannelShellInitialData } from './channel-shell-initial-data';

const CHANNEL_SIDEBAR_WIDTH = '18rem'; // 288px
const CARD_GAP_PX = 8;
const THIN_HEADER_HEIGHT = 42;
const HEADER_PADDING = 4; // 2px top + 2px bottom
const HEADER_AREA_HEIGHT = THIN_HEADER_HEIGHT + HEADER_PADDING; // 46px
const MOBILE_TOP_BAR_HEIGHT = 64; // ChannelMobileTopBar h-16
const TABLET_BREAK = 768;

type Props = {
  profile?: unknown;
  user: string;
  initialData?: ChannelShellInitialData;
  footer: ReactNode;
  children: ReactNode;
};

export function ChannelShell({
  user,
  initialData,
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
          '--sidebar-width': CHANNEL_SIDEBAR_WIDTH,
          '--card-gap': `${CARD_GAP_PX}px`,
          '--site-sticky-top': `calc(var(--meloming-top-notice-height) + ${HEADER_AREA_HEIGHT}px)`,
        } as CSSProperties
      }
    >
      <div
        data-site-sticky-context="fixed-header"
        className="flex w-full min-h-svh flex-col bg-muted"
      >
        {/* Desktop: visual frame overlay */}
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

        {/* ThinHeader: sticky, bg-muted, z-[60] */}
        <div className="sticky top-[var(--meloming-top-notice-height)] z-[60] bg-muted py-0.5">
          <GlobalThinHeader
            activeService="portal"
            logoSrc="/logo/meloming-logo-full.png"
            logoAlt="멜로밍"
            userSlot={
              <HeaderProfileMenu />
            }
          />
        </div>

        {/* 콘텐츠 */}
        <div className="flex flex-1 w-full pb-[var(--card-gap)] px-[var(--card-gap)]">
          <div className="relative flex flex-1 w-full bg-background rounded-xl">
            <ChannelMenuSidebar user={user} initialData={initialData} />
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
          '--sidebar-width': CHANNEL_SIDEBAR_WIDTH,
          '--site-sticky-top': `calc(var(--meloming-top-notice-height) + ${MOBILE_TOP_BAR_HEIGHT}px)`,
        } as CSSProperties
      }
    >
      <div
        data-site-sticky-context="fixed-header"
        className="flex w-full min-h-svh flex-col"
      >
        {/* Mobile: 상단 바 (fixed, 64px) */}
        <div className="fixed top-[var(--meloming-top-notice-height)] left-0 right-0 z-40">
          <ChannelMobileTopBar
            user={user}
            initialChannel={initialData?.channel}
          />
        </div>

        {/* 콘텐츠 */}
        <div className="flex-1" style={{
            paddingTop: `calc(var(--meloming-top-notice-height) + ${MOBILE_TOP_BAR_HEIGHT}px)`,
          }}>
          <ChannelMenuSidebar user={user} initialData={initialData} />
          <main>{children}</main>
          {footer}
        </div>
      </div>
    </SidebarProvider>
  );

  return (
    <>
      <div className="channel-desktop" style={{ display: 'contents' }}>{desktopUI}</div>
      <div className="channel-mobile" style={{ display: 'none' }}>{mobileUI}</div>
      <style dangerouslySetInnerHTML={{ __html: `
        @media (max-width: ${TABLET_BREAK - 1}px) {
          .channel-desktop { display: none !important; }
          .channel-mobile  { display: contents !important; }
        }
      ` }} />
    </>
  );
}
