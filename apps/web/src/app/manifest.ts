import type { MetadataRoute } from 'next';

/** Served at /manifest.webmanifest. Icons are static SVGs owned by this repository. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '로기챗',
    short_name: '로기챗',
    description: '후로기와 팬이 만나는 로기챗 채팅 공간',
    lang: 'ko',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icons/rogichat-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/rogichat-icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
