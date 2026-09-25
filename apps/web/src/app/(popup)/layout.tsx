import type { ReactNode } from 'react';

import '../meloming-globals.css';
import { ThemeProvider } from '@/meloming/shared/providers/theme-provider';
import { QueryProvider } from '@/meloming/shared/providers/query-provider';
import { Toaster } from '@/meloming/shared/components/ui/sonner';

export default function PopupLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute={['class', 'data-theme']} defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryProvider>
        {children}
        <Toaster />
      </QueryProvider>
    </ThemeProvider>
  );
}
