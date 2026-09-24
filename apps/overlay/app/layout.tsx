import type { Metadata } from "next";
import "./globals.css";
import "./overlay.css";
import { QueryProvider } from "@/shared/providers/query-provider";

export const metadata: Metadata = {
  title: {
    default: "멜로밍 오버레이",
    template: "%s - 멜로밍 오버레이",
  },
  description: "OBS 브라우저 소스용 멜로밍 오버레이",
  icons: {
    icon: [
      {
        url: "/logo/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/logo/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      { url: "/logo/favicon.ico" },
    ],
    apple: [
      {
        url: "/logo/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

const overlayObsCompatScript = `
(function () {
  var root = document.documentElement;

  function forceTransparent(element) {
    if (!element || !element.style) return;
    element.style.setProperty('background', 'transparent', 'important');
    element.style.setProperty('background-color', 'transparent', 'important');
  }

  function injectCriticalStyles() {
    if (document.getElementById('overlay-critical-transparent-css')) return;
    var style = document.createElement('style');
    style.id = 'overlay-critical-transparent-css';
    style.type = 'text/css';
    style.appendChild(document.createTextNode(
      'html,body,#__next,.overlay-root{' +
        'background:transparent!important;' +
        'background-color:transparent!important;' +
      '}' +
      'html,body{' +
        'margin:0!important;' +
        'overflow:hidden!important;' +
      '}'
    ));
    (document.head || document.documentElement).appendChild(style);
  }

  root.classList.add('overlay-document');
  forceTransparent(root);
  injectCriticalStyles();

  var ua = navigator.userAgent || '';
  var chromeMatch = ua.match(/(?:Chrome|Chromium)\\/(\\d+)/);
  var chromeMajor = chromeMatch ? Number(chromeMatch[1]) : 0;
  var isObs =
    typeof window.obsstudio !== 'undefined' ||
    /\\bOBS\\//i.test(ua) ||
    /obs-browser/i.test(ua);

  function cssSupports(prop, value) {
    try {
      return !!(window.CSS && CSS.supports && CSS.supports(prop, value));
    } catch (_) {
      return false;
    }
  }

  function cssSupportsSelector(selector) {
    try {
      return !!(window.CSS && CSS.supports && CSS.supports('selector(' + selector + ')'));
    } catch (_) {
      return false;
    }
  }

  var supportsHas = cssSupportsSelector(':has(*)');
  var supportsBackdrop =
    cssSupports('backdrop-filter', 'blur(1px)') ||
    cssSupports('-webkit-backdrop-filter', 'blur(1px)');
  var isLegacyChromium = chromeMajor > 0 && chromeMajor < 105;
  var isLegacyObsCef = isObs && !supportsHas;
  var shouldUseLegacyOverlay = isLegacyChromium || isLegacyObsCef;

  if (isObs) {
    root.classList.add('obs-browser-source');
  }
  if (isLegacyChromium) {
    root.classList.add('overlay-legacy-chromium');
  }
  if (!supportsBackdrop || shouldUseLegacyOverlay) {
    root.classList.add('no-overlay-backdrop-filter');
  }
  if (shouldUseLegacyOverlay) {
    root.classList.add('obs-legacy-cef');
  }

  function loadLegacyStyles() {
    if (!shouldUseLegacyOverlay) return;
    if (document.querySelector('link[data-overlay-legacy-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/legacy/overlay-tailwind-compat.css';
    link.setAttribute('data-overlay-legacy-css', 'true');
    (document.head || document.documentElement).appendChild(link);
  }

  function applyBody() {
    if (!document.body) return;
    document.body.classList.add('overlay-body');
    forceTransparent(document.body);
    var overlayRoot = document.querySelector('.overlay-root');
    forceTransparent(overlayRoot);
  }

  loadLegacyStyles();
  applyBody();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBody);
  } else {
    applyBody();
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="overlay-document">
      <body className="overlay-body">
        <script
          id="overlay-obs-compat"
          dangerouslySetInnerHTML={{ __html: overlayObsCompatScript }}
        />
        <QueryProvider>
          <div className="overlay-root">{children}</div>
        </QueryProvider>
      </body>
    </html>
  );
}
