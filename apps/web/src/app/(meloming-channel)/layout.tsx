import type { ReactNode } from 'react';

import '../meloming-globals.css';
import { ThemeProvider } from '@/meloming/shared/providers/theme-provider';
import { QueryProvider } from '@/meloming/shared/providers/query-provider';
import { Toaster } from '@/meloming/shared/components/ui/sonner';
import DefaultLayout from '@/meloming/app/(default)/layout';

// Meloming's root provider order, mounted below Rogichat's document/runtime boundary.
export default function MelomingChannelLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute={['class', 'data-theme']} defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryProvider>
        <DefaultLayout>{children}</DefaultLayout>
        <Toaster />
      </QueryProvider>
    </ThemeProvider>
  );
}
