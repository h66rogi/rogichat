import Link from 'next/link';
import { Info, MessageSquareText, type LucideIcon } from 'lucide-react';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';
import type { ChannelDescriptor } from '../model/channel-descriptor';
import { CHANNEL_FEATURES, channelHref } from '../model/channel-features';
import { ChannelAvatar } from '../shell/channel-avatar';

/**
 * Public channel home (Server Component).
 *
 * Adapted from meloming-front f8907f37e73d0b760eac3c5af2beb48714331c83
 * `src/domains/channel/components/section/home.tsx`: the 12-column home grid (8/4 split on desktop) and
 * the quick-link card pattern (round icon, title, description, action chip). Rogichat changes: no song,
 * pricing, guestbook, schedule or anniversary queries; the page is built from the reviewed channel
 * descriptor only and shows no message content, participation state or counts.
 */
export function ChannelHome({ channel }: { channel: ChannelDescriptor }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 md:px-8 md:py-12">
      <section aria-labelledby="channel-home-title" className="flex flex-col items-center gap-5 text-center md:flex-row md:items-center md:gap-8 md:text-left">
        <ChannelAvatar name={channel.displayName} src={channel.avatarSrc} className="size-28 text-[36px] md:size-32" />
        <div className="flex min-w-0 flex-col items-center gap-3 md:items-start">
          <div className="flex flex-col items-center gap-2 md:items-start">
            <h1 id="channel-home-title" className="text-[28px] font-bold leading-tight text-ink">
              {channel.displayName}
            </h1>
            <Badge variant="secondary">{channel.platformLabel} 스트리머</Badge>
          </div>
          <p className="max-w-prose text-[16px] leading-normal text-body">
            {channel.displayName}와 팬이 만나는 로기챗의 채팅 공간입니다. 로그인하고 SOOP 계정을 연결하면
            채팅방에 들어갈 수 있어요.
          </p>
          {channel.intro ? <p className="max-w-prose text-[16px] leading-normal text-body">{channel.intro}</p> : null}
          <div className="flex flex-wrap justify-center gap-3 md:justify-start">
            <Button asChild>
              <Link href={channelHref('chat')}>채팅 들어가기</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={channelHref('rules')}>이용 안내</Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <div className={cn('flex flex-col gap-4', channel.officialLinks.length > 0 ? 'md:col-span-8' : 'md:col-span-12')}>
          <FeatureCard
            icon={MessageSquareText}
            title={`${channel.displayName} ${CHANNEL_FEATURES.chat.label}`}
            description="팬은 후로기에게 개인 메시지를 보내고, 후로기의 전체 메시지와 나에게 온 답장을 한 타임라인에서 봅니다."
            href={channelHref('chat')}
            action="입장"
          />
          <FeatureCard
            icon={Info}
            title={CHANNEL_FEATURES.rules.label}
            description="채팅 규칙, 개인답장이 공개될 수 있는 경우, 방 나가기와 계정 탈퇴의 차이를 안내합니다."
            href={channelHref('rules')}
            action="보기"
          />
        </div>
        {channel.officialLinks.length > 0 ? (
          <aside className="flex flex-col gap-4 md:col-span-4">
            <section aria-labelledby="channel-links-title" className="rounded-md border border-line px-5 py-5">
              <h2 id="channel-links-title" className="text-[18px] font-semibold text-ink">
                공식 링크
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
                {channel.officialLinks.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center text-[16px] text-ink underline-offset-4 hover:underline"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  href,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 rounded-md border border-line bg-canvas px-5 py-4 transition-colors hover:bg-surface-soft"
    >
      <span className="flex min-w-0 items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand/10 text-action">
          <Icon className="size-6" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[18px] font-semibold text-ink">{title}</span>
          <span className="text-[14px] leading-[1.43] text-muted">{description}</span>
        </span>
      </span>
      <span className="inline-flex h-11 shrink-0 items-center rounded-sm border border-control-border px-4 text-[14px] font-semibold text-ink">
        {action}
      </span>
    </Link>
  );
}
