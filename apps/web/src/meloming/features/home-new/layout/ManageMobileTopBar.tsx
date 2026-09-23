'use client';

import Link from 'next/link';
import { useChannel } from '@/meloming/domains/channel/hooks/use-channel';
import { SidebarTrigger } from '@/meloming/shared/components/ui/sidebar';
import UserAvatar from '@/meloming/domains/channel/components/channel/user-avatar';

type Props = {
  user: string;
};

export function ManageMobileTopBar({ user }: Props) {
  const { data: channel } = useChannel(user);
  const channelName = channel?.name ?? '채널';
  const channelHref = channel?.webPath ? `/channel/${channel.webPath}` : '/';

  return (
    <div className="flex items-center gap-2 px-3 h-16 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border">
      <SidebarTrigger
        className="size-9 -ml-1 rounded-full text-foreground hover:bg-accent"
        aria-label="채널 관리 메뉴 열기"
      />

      <Link
        href={channelHref}
        className="flex items-center gap-2 min-w-0 flex-1 hover:bg-accent/40 rounded-md px-1.5 py-1 transition-colors"
        aria-label={`${channelName} 채널 페이지로 이동`}
      >
        <UserAvatar
          userName={channelName}
          profileImageUrl={channel?.profileImageUrl}
          className="size-8 rounded-full object-cover shrink-0 select-none border-none"
          fallbackStyle={{ color: 'var(--foreground)' }}
        />
        <div className="flex flex-col min-w-0 leading-tight">
          <span className="text-sm font-bold truncate paperlogy">
            {channelName}
          </span>
          <span className="text-[10px] text-muted-foreground paperlogy">
            관리자 페이지
          </span>
        </div>
      </Link>
    </div>
  );
}
