import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

/** QA builds carry preview routes and are not the product origin: keep crawlers out of them. */
const isQaBuild = process.env.NEXT_PUBLIC_ROGICHAT_WEB_ENV === 'qa';

export const metadata: Metadata = {
  title: {
    default: '로기챗',
    template: '%s · 로기챗',
  },
  description: '후로기와 팬이 만나는 로기챗 채팅 공간',
  applicationName: '로기챗',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: '로기챗',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  robots: isQaBuild ? { index: false, follow: false } : { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
