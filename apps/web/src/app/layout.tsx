import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { runtimeConfig } from '@/core/runtime/config';
import { RuntimeProvider } from '@/core/runtime/provider';
import { PrivateSessionProvider } from '@/features/auth/private-session';
import { nanumSquareNeo } from './fonts';
export const dynamic = 'force-dynamic';

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
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const config = runtimeConfig();
  return (
    <html lang="ko" className={nanumSquareNeo.variable}>
      <body><RuntimeProvider apiOrigin={config.apiOrigin} defaultRoomId={config.defaultRoomId} mediaStorageOrigins={config.mediaStorageOrigins}><PrivateSessionProvider>{children}</PrivateSessionProvider></RuntimeProvider></body>
    </html>
  );
}
