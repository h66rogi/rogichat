'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

// react-pdf is SSR-incompatible -> dynamic import with ssr:false
const Document = dynamic(() => import('react-pdf').then((m) => m.Document), { ssr: false });
const Page = dynamic(() => import('react-pdf').then((m) => m.Page), { ssr: false });

if (typeof window !== 'undefined') {
  // Configure pdfjs worker once at module load (browser only).
  // Uses bundled worker via Next.js asset URL.
  import('react-pdf').then((m) => {
    m.pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  });
}

// pdfjs Document options. cmaps / standard_fonts / wasm 는 빌드 시점에
// public/_pdfjs/ 로 복사된다 (scripts/copy-pdfjs-assets.mjs). 매 render 마다
// 새 객체 참조면 PDF reload 되므로 모듈 스코프 고정.
const PDF_OPTIONS = {
  standardFontDataUrl: '/_pdfjs/standard_fonts/',
  cMapUrl: '/_pdfjs/cmaps/',
  cMapPacked: true,
  wasmUrl: '/_pdfjs/wasm/',
};

/**
 * 단일 PDF 페이지를 그리는 dumb renderer. zoom / pan / swipe 은 부모
 * SheetMusicCanvas 가 transform 으로 처리. 여기서는 react-pdf 의 scale=1 로
 * 한 페이지를 viewport 자연 크기로 그리고, 화면 fit 은 컨테이너 (max-w/h-full
 * object-contain 동등 효과 — react-pdf canvas 는 명시 width/height) 으로 위임.
 *
 * 다중 페이지 PDF 의 페이지 사이 이동은 부모가 page prop 으로 제어.
 */
export interface PdfViewerProps {
  url: string;
  /** 표시할 페이지 (1-indexed). */
  page: number;
  /** PDF 의 자연 회전 + 사용자 회전 합성 (90/180/270). */
  rotation: number;
  onTotalPages?: (n: number) => void;
}

export function PdfViewer({
  url,
  page,
  rotation,
  onTotalPages,
}: PdfViewerProps) {
  const [error, setError] = useState<Error | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);

  const handleDocLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => onTotalPages?.(numPages),
    [onTotalPages],
  );
  const documentLoading = useMemo(
    () => <div className="text-center p-8">악보 로딩 중...</div>,
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setError(null);
    setPdfData(null);

    async function loadPdf() {
      try {
        const res = await fetch(url, {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);

        const buffer = await res.arrayBuffer();
        if (!cancelled) setPdfData(buffer);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const nextError =
          err instanceof Error ? err : new Error('PDF fetch failed');
        console.error('[sheet-music PdfViewer] fetch failed', {
          url,
          name: nextError.name,
          message: nextError.message,
        });
        setError(nextError);
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url]);

  if (error) {
    return (
      <div className="text-center p-8 text-destructive">
        악보를 불러올 수 없습니다. 파일이 손상되었을 수 있습니다.
      </div>
    );
  }

  if (!pdfData) return documentLoading;

  return (
    <Document
      file={pdfData}
      options={PDF_OPTIONS}
      onLoadSuccess={handleDocLoadSuccess}
      onLoadError={(err) => {
        // 진단 로깅 — "파일 손상" 으로 일괄 표시되는 케이스의 실제 원인을
        // DevTools 에서 즉시 확인.
        console.error('[sheet-music PdfViewer] load failed', {
          url,
          name: err.name,
          message: err.message,
        });
        setError(err);
      }}
      loading={documentLoading}
    >
      {/*
        scale=1: react-pdf 가 PDF 자연 크기로 canvas 를 그린다. 부모
        SheetMusicCanvas 가 transform: scale 로 zoom 을 적용하므로 여기서
        scale 을 곱하면 이중 스케일이 된다. fit 은 부모 viewport + this
        canvas 의 자연 크기 비율로 자동 결정 (canvas 가 viewport 보다 클 때
        TransformWrapper 의 limitToBounds 가 처리).
      */}
      <Page
        pageNumber={page}
        scale={1}
        rotate={rotation}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        // canvas 가 viewport 안에 fit 되도록 max-width/height 강제.
        // react-pdf canvas 는 inline style width/height 가지므로 div wrapper
        // 클래스로 스케일 조절.
        className="max-w-full max-h-full"
      />
    </Document>
  );
}
