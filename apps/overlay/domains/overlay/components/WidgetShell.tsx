'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CustomCssInjector } from './CustomCssInjector';
import { OverlayCssInspector } from './OverlayCssInspector';
import type { OverlayWidgetType } from '../hooks/use-widget-custom-css';

interface Props {
  widget: OverlayWidgetType;
  customCss: string | null;
  children?: ReactNode;
}

/**
 * Wraps each overlay widget with a stable data-* API and CSS injection.
 * Also listens for OVERLAY_CSS_PREVIEW_UPDATE postMessage from the admin
 * iframe parent, so the editor draft is reflected live without saving.
 */
export function WidgetShell({ widget, customCss, children }: Props) {
  const [previewCss, setPreviewCss] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (
        data?.type === 'OVERLAY_CSS_PREVIEW_UPDATE' &&
        data.widget === widget
      ) {
        const css = data.css;
        setPreviewCss(typeof css === 'string' ? css : null);
      }
    };
    window.addEventListener('message', handler);

    // Signal parent that we're ready to receive preview CSS
    window.parent?.postMessage(
      { type: 'OVERLAY_CSS_PREVIEW_READY' },
      '*',
    );

    return () => window.removeEventListener('message', handler);
  }, [widget]);

  // Preview CSS takes priority over saved CSS (when previewing in admin iframe)
  const effectiveCss = previewCss ?? customCss;

  return (
    <div
      data-overlay-widget={widget}
      data-overlay-version="1"
      style={{ width: '100%', height: '100%' }}
    >
      <CustomCssInjector widget={widget} css={effectiveCss} />
      <OverlayCssInspector widget={widget} />
      {children}
    </div>
  );
}
