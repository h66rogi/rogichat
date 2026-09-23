'use client';
import { useEffect, useRef, useState } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/**
 * MusicXML SVG 를 자연 크기로 그리는 dumb renderer. zoom / pan / fit 은 부모
 * SheetMusicCanvas 가 transform 으로 처리. OSMD 자체 zoom 은 1.0 고정.
 *
 * MusicXML 은 Phase 2 다중 슬롯 대상 외 — 자체 다중 마디 표현. 한 곡당 1 슬롯.
 */
export interface MusicXmlViewerProps {
  url: string;
}

export function MusicXmlViewer({ url }: MusicXmlViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const abort = new AbortController();
    let cancelled = false;
    async function load() {
      const container = containerRef.current;
      if (!container) return;
      setLoading(true);
      setError(null);
      try {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (cancelled) return;
        if (osmdRef.current) {
          container.replaceChildren();
        }
        const osmd = new OpenSheetMusicDisplay(container, {
          autoResize: true,
          backend: 'svg',
          drawTitle: true,
        });
        osmdRef.current = osmd;
        const res = await fetch(url, {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: abort.signal,
        });
        if (!res.ok) throw new Error('fetch failed');
        const xml = await res.text();
        if (cancelled) return;
        await osmd.load(xml);
        if (cancelled) return;
        // zoom 은 부모 SheetMusicCanvas 의 transform 이 처리. 여기는 1.0 고정.
        osmd.zoom = 1;
        osmd.render();
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        console.error('[sheet-music MusicXmlViewer] load failed', e);
        setError('MusicXML을 불러올 수 없습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      abort.abort();
      const container = containerRef.current;
      if (container) container.replaceChildren();
      osmdRef.current = null;
    };
  }, [url]);

  if (error)
    return <div className="text-center p-8 text-destructive">{error}</div>;
  // Canvas 의 limitToBounds 와 충돌하지 않도록 자체 overflow 는 제거. zoom/pan
  // 은 부모 SheetMusicCanvas 의 transform 이 처리.
  return (
    <div className="max-w-full max-h-full">
      {loading && <div className="text-center p-8">악보 로딩 중...</div>}
      <div ref={containerRef} />
    </div>
  );
}
