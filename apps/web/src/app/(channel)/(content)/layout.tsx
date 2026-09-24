import type { ReactNode } from 'react';

import '@/meloming/shared/styles/content-view.css';
import './feature.css';
import { ChannelIdentifierProvider } from '@/meloming/domains/channel/hooks/channel-identifier-context';
import { QueryProvider } from '@/meloming/shared/providers/query-provider';
import { ThemeProvider } from '@/meloming/shared/providers/theme-provider';
import { Toaster } from '@/meloming/shared/components/ui/sonner';

/** Keep the copied feature implementation mounted within Rogichat's one channel shell. */
export default function ChannelContentLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem={false}>
      <QueryProvider>
        <ChannelIdentifierProvider identifier="h66rogi">
          <div data-channel-feature className="rogichat-feature min-w-0 flex-1">
            {children}
          </div>
          <Toaster />
        </ChannelIdentifierProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
