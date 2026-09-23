'use client';
import { PdfViewer } from './viewers/PdfViewer';
import { ImageViewer } from './viewers/ImageViewer';
import { MusicXmlViewer } from './viewers/MusicXmlViewer';
import { SheetMusicCanvas } from './SheetMusicCanvas';
import type { SheetMusicType } from './utils/detectSheetMusicType';

/**
 * SheetMusicViewer — type 별 dumb renderer 를 표준 SheetMusicCanvas 안에 주입.
 * forScore UX (zoom 1.0=fit, pinch zoom, swipe page nav, double-tap toggle) 는
 * SheetMusicCanvas 가 통일 처리. 각 renderer 는 한 페이지만 그린다.
 */
export interface SheetMusicViewerProps {
  url: string;
  type: SheetMusicType;
  zoom: number;
  page: number;
  rotation: number;
  /** 사용자 pinch / double-tap 으로 zoom 변경 시 외부 state 동기화. */
  onZoomChange?: (zoom: number) => void;
  /** 다중 페이지 PDF 의 다음/이전 페이지 (Phase 2 에서 다중 슬롯도 통합 처리). */
  onPagePrev?: () => void;
  onPageNext?: () => void;
  canPagePrev?: boolean;
  canPageNext?: boolean;
  onTotalPages?: (n: number) => void;
}

export function SheetMusicViewer({
  url,
  type,
  zoom,
  page,
  rotation,
  onZoomChange,
  onPagePrev,
  onPageNext,
  canPagePrev = false,
  canPageNext = false,
  onTotalPages,
}: SheetMusicViewerProps) {
  return (
    <SheetMusicCanvas
      zoom={zoom}
      onZoomChange={onZoomChange}
      onSwipeLeft={onPageNext}
      onSwipeRight={onPagePrev}
      canPagePrev={canPagePrev}
      canPageNext={canPageNext}
    >
      {type === 'PDF' && (
        <PdfViewer
          url={url}
          page={page}
          rotation={rotation}
          onTotalPages={onTotalPages}
        />
      )}
      {type === 'IMAGE' && <ImageViewer url={url} rotation={rotation} />}
      {type === 'MUSICXML' && <MusicXmlViewer url={url} />}
    </SheetMusicCanvas>
  );
}
