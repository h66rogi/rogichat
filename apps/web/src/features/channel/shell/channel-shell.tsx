import type { ReactNode } from 'react';
import Link from 'next/link';

import type { ChannelDescriptor } from '../model/channel-descriptor';
import { channelHref } from '../model/channel-features';
import { ChannelMenu } from './channel-menu';
import { ChannelMobileTopBar } from './channel-mobile-top-bar';
import { ChannelProfileCard } from './channel-profile-card';

/**
 * Adapted from meloming-front f8907f37e73d0b760eac3c5af2beb48714331c83
 * `src/features/home-new/layout/ChannelShell.tsx`: thin top bar, a card-shaped content frame with a
 * 18rem sidebar (profile + menu), main area and footer, and a 64px mobile top bar with an off-canvas menu.
 * Rogichat changes: the original rendered separate desktop and mobile trees and toggled them with CSS,
 * which mounts `children` twice. This shell renders ONE tree; only the aside (desktop) and the Sheet
 * (mobile) differ, so chat and socket lifetimes exist once. The global header, profile menu, top notice
 * variable and sidebar cookie/keyboard shortcut are not carried over.
 */
export function ChannelShell({ channel, children }: { channel: ChannelDescriptor; children: ReactNode }) {
  return (
    <div data-shell-root className="flex min-h-svh flex-col bg-surface-soft">
      <header
        data-shell-top-bar
        className="sticky top-[env(safe-area-inset-top,0px)] z-40 hidden h-12 items-center justify-between px-4 md:flex"
      >
        <Link href={channelHref('home')} className="rounded-sm text-[18px] font-bold tracking-tight text-ink">
          로기챗
        </Link>
        <span className="text-[14px] text-muted">{channel.displayName}의 공간</span>
      </header>

      <ChannelMobileTopBar channel={channel} />

      <div className="flex w-full flex-1 md:px-2 md:pb-2">
        <div className="flex w-full flex-1 bg-canvas md:rounded-md md:border md:border-line">
          <aside
            data-shell-aside
            className="sticky top-[calc(var(--shell-top-bar-height)+env(safe-area-inset-top,0px))] hidden max-h-[calc(100svh-var(--shell-top-bar-height)-var(--shell-gap))] w-[18rem] shrink-0 flex-col self-start overflow-y-auto md:flex"
          >
            <ChannelProfileCard channel={channel} />
            <div className="px-3 pt-2 pb-4">
              <ChannelMenu channel={channel} />
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col md:border-l md:border-line-subtle">
            <main data-shell-main className="flex min-w-0 flex-1 flex-col">
              {children}
            </main>
            <footer data-shell-footer className="border-t border-line-subtle px-4 py-4 text-[13px] text-muted md:px-6">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>로기챗</span>
                <Link href={channelHref('rules')} className="hover:text-ink hover:underline">
                  이용 안내
                </Link>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
