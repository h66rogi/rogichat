// Live preview via postMessage — overlay pages listen for
// OVERLAY_CSS_PREVIEW_UPDATE and inject the CSS into a <style> tag.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OverlayWidgetType } from '@/meloming/domains/channel/types/overlay-customization';

const OVERLAY_BASE = process.env.NEXT_PUBLIC_OVERLAY_BASE_URL ?? '';

const TRANSPARENT_PREVIEW_BG =
  'linear-gradient(45deg, rgba(148,163,184,0.25) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.25) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.25) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.25) 75%)';

interface Props {
  overlayToken: string;
  widget: OverlayWidgetType;
  /** Live draft CSS from the editor — sent to iframe via postMessage on every change. */
  draftCss: string;
  /** When true, sends INSPECTOR_START to iframe so user can click an element to get its selector. */
  inspectorActive: boolean;
  /** Called when the user clicks an element in the iframe, OR when the inspector is dismissed. */
  onInspectorResult: (result: { selector: string } | null) => void;
  className?: string;
}

export function OverlayCssPreview({
  overlayToken,
  widget,
  draftCss,
  inspectorActive,
  onInspectorResult,
  className,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isReady, setIsReady] = useState(false);
  const url = `${OVERLAY_BASE}/overlay/${overlayToken}/widgets/${widget}?preview=1`;

  // Listen for iframe messages: ready, inspector picked, inspector stopped
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === 'OVERLAY_CSS_PREVIEW_READY') {
        setIsReady(true);
      } else if (data?.type === 'OVERLAY_CSS_INSPECTOR_PICKED' && data.widget === widget) {
        onInspectorResult({ selector: data.selector });
      } else if (data?.type === 'OVERLAY_CSS_INSPECTOR_STOPPED' && data.widget === widget) {
        onInspectorResult(null);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [widget, onInspectorResult]);

  // Reset ready state when widget changes (iframe remounts)
  useEffect(() => {
    setIsReady(false);
  }, [widget]);

  const postToIframe = useCallback((message: unknown) => {
    const iframe = iframeRef.current;
    iframe?.contentWindow?.postMessage(message, '*');
  }, []);

  const sendCss = useCallback(
    (css: string) => {
      postToIframe({ type: 'OVERLAY_CSS_PREVIEW_UPDATE', widget, css });
    },
    [postToIframe, widget],
  );

  useEffect(() => {
    if (isReady) {
      sendCss(draftCss);
    }
  }, [isReady, draftCss, sendCss]);

  // Control the inspector in the iframe
  useEffect(() => {
    if (!isReady) return;
    postToIframe({
      type: inspectorActive
        ? 'OVERLAY_CSS_INSPECTOR_START'
        : 'OVERLAY_CSS_INSPECTOR_STOP',
      widget,
    });
  }, [inspectorActive, isReady, postToIframe, widget]);

  return (
    <div
      className={className ?? 'w-full h-[600px] rounded-lg border overflow-hidden'}
      style={{
        backgroundImage: TRANSPARENT_PREVIEW_BG,
        backgroundSize: '16px 16px',
        backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
        backgroundColor: '#1e293b',
      }}
    >
      <iframe
        key={widget}
        ref={iframeRef}
        src={url}
        className="size-full border-0"
        title={`${widget} preview`}
      />
    </div>
  );
}
