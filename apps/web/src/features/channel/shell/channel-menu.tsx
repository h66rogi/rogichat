'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, CalendarDays, Home, Info, ListMusic, MessageSquareText, Settings, Shirt, type LucideIcon } from 'lucide-react';

import { cn } from '@/shared/lib/cn';
import type { ChannelDescriptor, ChannelFeatureKey } from '../model/channel-descriptor';
import { channelHref, featureFromPath, menuItemsFor } from '../model/channel-features';

/**
 * Adapted from meloming-front f8907f37e73d0b760eac3c5af2beb48714331c83
 * `src/domains/channel/components/channel/channel-menu-sidebar.tsx` (`TAB_ICONS`, `ChannelSidebarMenuLink`):
 * pill-shaped navigation links with icon, label and `aria-current`. Rogichat changes: no drag-and-drop
 * editor, no feature-settings mutation, no verified filter, no toast; items come from the channel
 * descriptor and link to their live routes.
 */
const FEATURE_ICONS: Record<ChannelFeatureKey, LucideIcon> = {
  home: Home,
  chat: MessageSquareText,
  rules: Info,
  settings: Settings,
  schedule: CalendarDays,
  wardrobe: Shirt,
  songbook: BookOpen,
  setlist: ListMusic,
};

export function ChannelMenu({ channel, onNavigate }: { channel: ChannelDescriptor; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = featureFromPath(pathname);

  return (
    <nav aria-label="채널 메뉴">
      <ul className="flex flex-col gap-1">
        {menuItemsFor(channel).map((item) => {
          const Icon = FEATURE_ICONS[item.key];
          const isActive = active === item.key;
          return (
            <li key={item.key}>
              <Link
                href={channelHref(item.key)}
                aria-current={isActive ? 'page' : undefined}
                {...(onNavigate ? { onClick: onNavigate } : {})}
                className={cn(
                  'flex min-h-12 items-center gap-4 rounded-full px-4 text-[17px] transition-colors',
                  isActive ? 'bg-brand/10 font-bold text-action-hover hover:bg-brand/15' : 'text-ink hover:bg-surface-soft',
                )}
              >
                <Icon className="size-6 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
