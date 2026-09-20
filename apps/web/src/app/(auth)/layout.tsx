import type { ReactNode } from 'react';
import Link from 'next/link';

import { channelHref } from '@/features/channel/model/channel-features';

/** Minimal frame for login and auth callback screens: wordmark, content, link back to the channel home. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <header className="flex h-14 items-center px-4 pt-[env(safe-area-inset-top,0px)] md:px-6">
        <Link href={channelHref('home')} className="rounded-sm text-[18px] font-bold tracking-tight text-ink">
          로기챗
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-8 md:px-6">{children}</main>
    </div>
  );
}
