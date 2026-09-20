'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Menu } from 'lucide-react';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/shared/ui/sheet';
import { cn } from '@/shared/lib/cn';
import type { ChannelDescriptor } from '../model/channel-descriptor';
import { CHANNEL_FEATURES, channelHref, featureFromPath } from '../model/channel-features';
import { ChannelAvatar } from './channel-avatar';
import { ChannelMenu } from './channel-menu';
import { ChannelProfileCard } from './channel-profile-card';

/**
 * Adapted from meloming-front f8907f37e73d0b760eac3c5af2beb48714331c83
 * `src/features/home-new/layout/ChannelMobileTopBar.tsx` and the mobile branch of
 * `src/features/home-new/layout/ChannelShell.tsx`: 64px top bar with a menu trigger, avatar and channel
 * name that links home, plus an off-canvas menu. Rogichat changes: no data fetching (descriptor is a prop),
 * the drawer is a shadcn Sheet that renders the same profile card and menu as the desktop aside, and the
 * chat feature shows a compact bar (back + feature title) so the timeline and composer keep their space.
 */
export function ChannelMobileTopBar({ channel }: { channel: ChannelDescriptor }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const feature = featureFromPath(pathname);
  const compact = feature === 'chat';

  return (
    <header
      data-shell-mobile-top-bar
      className={cn(
        'sticky top-[env(safe-area-inset-top,0px)] z-40 flex items-center gap-2 border-b border-line bg-canvas/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-canvas/85 md:hidden',
        compact ? 'h-14' : 'h-16',
      )}
    >
      {compact ? (
        <Link
          href={channelHref('home')}
          aria-label="채널 홈으로 이동"
          className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface-soft"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label="채널 메뉴 열기"
          className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface-soft"
        >
          <Menu className="size-6" aria-hidden="true" />
        </SheetTrigger>
        <SheetContent side="left" className="w-[18rem] max-w-[85vw] overflow-y-auto p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>채널 메뉴</SheetTitle>
            <SheetDescription>{channel.displayName} 채널의 화면으로 이동합니다.</SheetDescription>
          </SheetHeader>
          <ChannelProfileCard channel={channel} compact />
          <div className="px-3 pb-4">
            <ChannelMenu channel={channel} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {compact ? (
        <p className="min-w-0 flex-1 truncate text-[17px] font-bold text-ink">
          {channel.displayName} {CHANNEL_FEATURES.chat.label}
        </p>
      ) : (
        <Link
          href={channelHref('home')}
          aria-label={`${channel.displayName} 채널 홈으로 이동`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-surface-soft"
        >
          <ChannelAvatar name={channel.displayName} src={channel.avatarSrc} className="size-8 text-[14px]" />
          <span className="min-w-0 flex-1 truncate text-[18px] font-bold text-ink">{channel.displayName}</span>
        </Link>
      )}
    </header>
  );
}
