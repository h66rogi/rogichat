import localFont from 'next/font/local';

export const nanumSquareNeo = localFont({
  src: [
    { path: '../../public/fonts/NanumSquareNeoTTF-aLt.woff2', weight: '300', style: 'normal' },
    { path: '../../public/fonts/NanumSquareNeoTTF-bRg.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/NanumSquareNeoTTF-cBd.woff2', weight: '700', style: 'normal' },
    { path: '../../public/fonts/NanumSquareNeoTTF-dEb.woff2', weight: '800', style: 'normal' },
    { path: '../../public/fonts/NanumSquareNeoTTF-eHv.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-nanum-square-neo',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['system-ui', 'sans-serif'],
});
