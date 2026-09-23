'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ChannelChat } from '../session/channel-chat';
import { featureFromPath } from '../model/channel-features';

/** Keep the authenticated chat alive during in-app navigation after its first visit. */
export function PersistentChannelContent({ children }: { children: ReactNode }) {
  const active = featureFromPath(usePathname()) === 'chat';
  const [navigation, setNavigation] = useState({ active, visited: active, visit: active ? 1 : 0 });
  let current = navigation;
  if (navigation.active !== active) {
    current = { active, visited: navigation.visited || active, visit: navigation.visit + (active ? 1 : 0) };
    setNavigation(current);
  }

  return <>
    {!active && children}
    {(active || current.visited) && <div
      data-chat-page={active ? '' : undefined}
      data-chat-column={active ? '' : undefined}
      hidden={!active}
      className={active ? 'mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col md:border-x md:border-line-subtle' : 'hidden'}
    ><ChannelChat active={active} visit={current.visit} /></div>}
  </>;
}
