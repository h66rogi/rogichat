'use client';
import { Button } from '@/meloming/shared/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/meloming/shared/components/ui/popover';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Maximize,
  Minimize,
  MoreHorizontal,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { SheetMusicFitMode } from './hooks/useLastViewState';
import type { SheetMusicType } from './utils/detectSheetMusicType';

export interface SheetMusicToolbarProps {
  type: SheetMusicType;
  page: number;
  totalPages?: number;
  isFullscreen: boolean;
  /**
   * P2: 현재 활성 fit 모드. Fit W/P 버튼의 active 시각 표시 + 단축키 popover 의
   * 현재 상태 indicator 에 사용.
   */
  fitMode?: SheetMusicFitMode;
  /**
   * P2: 현재 적용 중인 zoom 배율 (0.25~5). toolbar 에 % 라벨로 노출하여
   * 사용자가 현재 배율을 즉시 인지하도록 한다.
   */
  zoom?: number;
  onPrev: () => void;
  onNext: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onToggleFullscreen: () => void;
  onRotate: () => void;
  onDownload: () => void;
  /**
   * 좁은 패널(라이브 콘솔 사이드)에서 호출. Prev/Next/Zoom/Rotate/Fullscreen 6개만
   * 노출하고 Fit W/P, Download, 단축키 안내는 More 오버플로우 popover 로 묶어
   * horizontal overflow 로 핵심 버튼이 잘리는 사고를 방지한다.
   */
  compact?: boolean;
}

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: '← / PageUp', label: '이전 페이지' },
  { keys: '→ / PageDown', label: '다음 페이지' },
  { keys: '+ / =', label: '확대' },
  { keys: '− / _', label: '축소' },
  { keys: '0', label: '너비 맞춤' },
  { keys: '1', label: '페이지 맞춤' },
  { keys: 'R', label: '회전' },
  { keys: 'D', label: '다운로드' },
  { keys: 'F', label: '전체화면' },
  { keys: 'Esc', label: '전체화면 해제' },
];

// B3: 모바일 터치 타겟 WCAG 2.5.5 (AAA 44x44). desktop(sm+) 은 컴팩트한 36/32px
// 유지하여 toolbar overflow 위험을 키우지 않고, 모바일에서만 floor 강제.
const ICON_BTN_TOUCH = 'min-h-11 min-w-11 sm:min-h-9 sm:min-w-9';
const SM_BTN_TOUCH = 'min-h-11 sm:min-h-8';

export function SheetMusicToolbar(p: SheetMusicToolbarProps) {
  // CRITICAL: 모든 Button 에 type="button" 명시.
  // SheetMusicSection 이 SongFormV2 의 <form> 내부에 렌더링될 수 있는데, HTML 표준상
  // <button> 의 기본 type 은 'submit' 이므로 zoom/fullscreen/print/page nav 클릭 시
  // 부모 form 이 submit 되어 신규 곡이 의도치 않게 저장되거나 PATCH 가 트리거된다.
  // P2: 좁은 viewport 에서 toolbar 가 잘리지 않고 가로 스크롤 가능하도록 overflow-x-auto.
  // compact 모드는 이미 6개 버튼이라 거의 wrap 없으나, non-compact 모드 (편집 폼 / 모달)
  // 는 14개 버튼 한 줄이라 좁은 모바일에서 잘림 발생.
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b bg-background sticky top-0 z-10 overflow-x-auto">
      {p.type === 'PDF' && (
        <>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={ICON_BTN_TOUCH}
            onClick={p.onPrev}
            disabled={p.page <= 1}
            title="이전 페이지 (←)"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm tabular-nums">
            {p.page} / {p.totalPages ?? '?'}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={ICON_BTN_TOUCH}
            onClick={p.onNext}
            disabled={!!p.totalPages && p.page >= p.totalPages}
            title="다음 페이지 (→)"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
        </>
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={ICON_BTN_TOUCH}
        onClick={p.onZoomOut}
        title="축소 (-)"
      >
        <ZoomOut className="w-4 h-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={ICON_BTN_TOUCH}
        onClick={p.onZoomIn}
        title="확대 (+)"
      >
        <ZoomIn className="w-4 h-4" />
      </Button>
      {/* P2: 현재 적용 중 zoom % — fitMode='none' 일 때만 표시 (fit 모드일 땐
          effective zoom 이 자동 계산이라 의미 없음). tabular-nums 로 폭 안정. */}
      {p.zoom !== undefined && p.fitMode === 'none' && (
        <span className="text-xs tabular-nums text-muted-foreground px-1 hidden sm:inline">
          {Math.round(p.zoom * 100)}%
        </span>
      )}
      {!p.compact && (
        <>
          {/* P2: Fit W/P active indicator — 현재 모드일 때 secondary variant 로
              하이라이트해 사용자가 어떤 fit 이 적용 중인지 즉시 인지. */}
          <Button
            type="button"
            size="sm"
            variant={p.fitMode === 'width' ? 'secondary' : 'ghost'}
            className={SM_BTN_TOUCH}
            onClick={p.onFitWidth}
            title="너비 맞춤 (0)"
            aria-pressed={p.fitMode === 'width'}
          >
            Fit W
          </Button>
          <Button
            type="button"
            size="sm"
            variant={p.fitMode === 'page' ? 'secondary' : 'ghost'}
            className={SM_BTN_TOUCH}
            onClick={p.onFitPage}
            title="페이지 맞춤 (1)"
            aria-pressed={p.fitMode === 'page'}
          >
            Fit P
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
        </>
      )}
      {(p.type === 'PDF' || p.type === 'IMAGE') && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={ICON_BTN_TOUCH}
          onClick={p.onRotate}
          title="회전 (R)"
        >
          <RotateCw className="w-4 h-4" />
        </Button>
      )}
      {!p.compact && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={ICON_BTN_TOUCH}
          onClick={p.onDownload}
          title="다운로드 (D)"
        >
          <Download className="w-4 h-4" />
        </Button>
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={ICON_BTN_TOUCH}
        onClick={p.onToggleFullscreen}
        title="전체화면 (F / Esc)"
      >
        {p.isFullscreen ? (
          <Minimize className="w-4 h-4" />
        ) : (
          <Maximize className="w-4 h-4" />
        )}
      </Button>
      {p.compact ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={ICON_BTN_TOUCH}
              title="더보기 / 단축키"
              aria-label="더보기 메뉴 (맞춤·다운로드·단축키)"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-2">
            <div className="flex flex-col gap-0.5">
              <Button
                type="button"
                variant={p.fitMode === 'width' ? 'secondary' : 'ghost'}
                size="sm"
                className="justify-start"
                onClick={p.onFitWidth}
                aria-pressed={p.fitMode === 'width'}
              >
                너비 맞춤 (0)
                {p.fitMode === 'width' && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    적용 중
                  </span>
                )}
              </Button>
              <Button
                type="button"
                variant={p.fitMode === 'page' ? 'secondary' : 'ghost'}
                size="sm"
                className="justify-start"
                onClick={p.onFitPage}
                aria-pressed={p.fitMode === 'page'}
              >
                페이지 맞춤 (1)
                {p.fitMode === 'page' && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    적용 중
                  </span>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={p.onDownload}
              >
                <Download className="w-3.5 h-3.5 mr-2" /> 다운로드 (D)
              </Button>
            </div>
            <div className="my-2 border-t" />
            <p className="text-xs font-semibold mb-1 text-foreground px-2">
              키보드 단축키
            </p>
            <ul className="space-y-1 px-2 pb-1">
              {SHORTCUTS.map((s) => (
                <li
                  key={s.keys}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-muted-foreground">{s.label}</span>
                  <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted border">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={ICON_BTN_TOUCH}
              title="키보드 단축키"
              aria-label="키보드 단축키 보기"
            >
              <Info className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3">
            <p className="text-xs font-semibold mb-2 text-foreground">
              키보드 단축키
            </p>
            <ul className="space-y-1">
              {SHORTCUTS.map((s) => (
                <li
                  key={s.keys}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-muted-foreground">{s.label}</span>
                  <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted border">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
