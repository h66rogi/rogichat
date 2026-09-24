import { Suspense, type ReactNode } from 'react';

import { resolveDefaultChannel } from '@/features/channel/model/channel-descriptor';
import { ChannelShell } from '@/features/channel/shell/channel-shell';
import { PersistentChannelContent } from '@/features/channel/shell/persistent-channel-content';
import { loadChannelBootstrap } from '@/core/server/channel-bootstrap';
import { PageSkeleton } from '@/shared/ui/page-skeleton';

/** Every channel screen (home, chat, rules, settings) shares one shell instance. */
async function ChannelContent({ children }: { children: ReactNode }) {
  const initial = await loadChannelBootstrap();
  return <PersistentChannelContent initial={initial}>{children}</PersistentChannelContent>;
}

export default function ChannelLayout({ children }: { children: ReactNode }) {
  return <ChannelShell channel={resolveDefaultChannel()}><Suspense fallback={<PageSkeleton />}><ChannelContent>{children}</ChannelContent></Suspense></ChannelShell>;
}
