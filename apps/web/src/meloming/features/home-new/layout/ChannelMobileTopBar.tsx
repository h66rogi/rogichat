'use client';

import Link from 'next/link';
import { useChannel } from '@/meloming/domains/channel/hooks/use-channel';
import { SidebarTrigger } from '@/meloming/shared/components/ui/sidebar';
import UserAvatar from '@/meloming/domains/channel/components/channel/user-avatar';
import type { Channel } from '@/meloming/domains/channel/types/channel';

type Props = {
  user: string;
  initialChannel?: Channel;
};

export function ChannelMobileTopBar({ user, initialChannel }: Props) {
  const { data: channel } = useChannel(user, { initialData: initialChannel });
  const channelName = channel?.name ?? '채널';
  const channelHref = channel?.webPath ? `/channel/${channel.webPath}` : '/';

  return (
    <div className="flex items-center gap-2 px-3 h-16 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border">
      <SidebarTrigger
        className="size-9 -ml-1 rounded-full text-foreground hover:bg-accent"
        aria-label="채널 메뉴 열기"
      />

      <Link
        href={channelHref}
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md px-1.5 py-1 transition-colors hover:bg-accent/40"
        aria-label={`${channelName} 채널 홈으로 이동`}
      >
        <UserAvatar
          userName={channelName}
          profileImageUrl={channel?.profileImageUrl}
          className="size-8 rounded-full object-cover shrink-0 select-none border-none"
          fallbackStyle={{ color: 'var(--foreground)' }}
        />
        <span className="min-w-0 flex-1 truncate text-lg font-bold leading-tight paperlogy">
          {channelName}
        </span>
      </Link>
    </div>
  );
}
