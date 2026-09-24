import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  typedRoutes: false,
  images: {
    // No remote image host is approved yet; the neutral placeholder is an inline SVG.
    remotePatterns: [],
  },
  async redirects() {
    const channelRoutes = [
      { suffix: '', destination: '/', permanent: false },
      { suffix: '/schedule', destination: '/schedule', permanent: true },
      { suffix: '/musicbook', destination: '/musicbook', permanent: true },
      { suffix: '/wardrobe', destination: '/wardrobe', permanent: true },
      { suffix: '/wardrobe/:itemId', destination: '/wardrobe/:itemId', permanent: true },
      { suffix: '/setlist', destination: '/setlist', permanent: true },
      { suffix: '/setlist/:sessionId', destination: '/setlist/:sessionId', permanent: true },
    ];
    return [
      ...['h66rogi', 'hurogi'].flatMap(identifier => channelRoutes.map(route => ({
        source: `/channel/${identifier}${route.suffix}`,
        destination: route.destination,
        permanent: route.permanent,
      }))),
      { source: '/images/hurogi-profile.png', destination: '/images/h66rogi-profile.png', permanent: true },
    ];
  },
  async headers() {
    return [
      {
        // Service worker: JavaScript at the web origin, never long-lived immutable cache.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'no-cache, max-age=0, must-revalidate' }],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // Native OAuth fallback must not disclose its URL through navigation referrers.
        source: '/mobile/auth/complete',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
