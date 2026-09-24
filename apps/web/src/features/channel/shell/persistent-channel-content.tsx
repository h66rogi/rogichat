'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ChannelChat } from '../session/channel-chat';
import { featureFromPath } from '../model/channel-features';
import type { ChannelBootstrap } from '@/core/server/channel-bootstrap';
import { RoomBootstrapProvider } from '../session/room-bootstrap';

/** Keep the authenticated chat alive during in-app navigation after its first visit. */
export function PersistentChannelContent({ children, initial }: { children: ReactNode; initial: ChannelBootstrap | null }) {
  const active = featureFromPath(usePathname()) === 'chat';
  const [navigation, setNavigation] = useState({ active, visited: active, visit: active ? 1 : 0 });
  let current = navigation;
  if (navigation.active !== active) {
    current = { active, visited: navigation.visited || active, visit: navigation.visit + (active ? 1 : 0) };
    setNavigation(current);
  }

  return <RoomBootstrapProvider initial={initial}>
    {!active && children}
    {(active || current.visited) && <div
      data-chat-page={active ? '' : undefined}
      data-chat-column={active ? '' : undefined}
      hidden={!active}
      className={active ? 'mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col md:border-x md:border-line-subtle' : 'hidden'}
    ><ChannelChat active={active} visit={current.visit} initial={initial} /></div>}
  </RoomBootstrapProvider>;
}
