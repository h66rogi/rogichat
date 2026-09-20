import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Build-time environment of the web bundle.
 *
 * `qa` builds include the explicit `/preview` routes (files named `*.preview.tsx`) that render
 * synthetic fixtures for design verification. Any other value, including an unset variable, is
 * the production shape: the preview page extension is not registered, so those routes do not
 * exist and the fixture modules they import are never part of the bundle.
 *
 * The two shapes build into distinct directories (`.next` and `.next-qa`) so a QA build can never leak
 * artifacts into a production standalone image. `tools/web/check-preview-isolation.mjs` verifies both.
 */
const webEnv = process.env.ROGICHAT_WEB_ENV === 'qa' ? 'qa' : 'production';
const isQa = webEnv === 'qa';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  distDir: isQa ? '.next-qa' : '.next',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  pageExtensions: [...(isQa ? ['preview.tsx'] : []), 'tsx', 'ts'],
  typedRoutes: false,
  env: {
    NEXT_PUBLIC_ROGICHAT_WEB_ENV: webEnv,
  },
  images: {
    // No remote image host is approved yet; the neutral placeholder is an inline SVG.
    remotePatterns: [],
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
          // The QA host must not be indexed: it carries preview routes and is not the product origin.
          ...(isQa ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
