import type { ReactNode } from 'react';

import { resolveDefaultChannel } from '@/features/channel/model/channel-descriptor';
import { ChannelShell } from '@/features/channel/shell/channel-shell';

/** Every channel screen (home, chat, rules, settings) shares one shell instance. */
export default function ChannelLayout({ children }: { children: ReactNode }) {
  return <ChannelShell channel={resolveDefaultChannel()}>{children}</ChannelShell>;
}
