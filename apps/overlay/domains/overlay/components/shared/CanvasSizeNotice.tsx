'use client';

const MIN_WIDTH = 1280;
const MIN_HEIGHT = 720;
const RECOMMENDED_WIDTH = 1920;
const RECOMMENDED_HEIGHT = 1080;

interface CanvasSizeNoticeProps {
  width: number;
  height: number;
}

/**
 * 통합 오버레이 캔버스가 1280x720 미만일 때 권장 해상도를 안내한다.
 * canvasSize 초기값(0,0)일 때는 측정 전이므로 표시하지 않는다.
 */
export function CanvasSizeNotice({ width, height }: CanvasSizeNoticeProps) {
  const measured = width > 0 && height > 0;
  const tooSmall = measured && (width < MIN_WIDTH || height < MIN_HEIGHT);

  if (!tooSmall) return null;

  return (
    <div
      data-overlay-notice="canvas-size"
      className="pointer-events-none absolute inset-0 z-[9999] flex items-center justify-center p-6"
    >
      <div className="pointer-events-auto max-w-md rounded-2xl border border-white/15 bg-black/75 px-6 py-5 text-center text-white shadow-2xl backdrop-blur-md">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
            aria-hidden
          >
            <path d="M3 7V4a1 1 0 0 1 1-1h3" />
            <path d="M17 3h3a1 1 0 0 1 1 1v3" />
            <path d="M21 17v3a1 1 0 0 1-1 1h-3" />
            <path d="M7 21H4a1 1 0 0 1-1-1v-3" />
            <path d="M9 9l-3 3 3 3" />
            <path d="M15 9l3 3-3 3" />
          </svg>
        </div>
        <p className="text-sm font-semibold leading-snug text-white/95">
          오버레이 크기가 너무 작아요
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/70">
          브라우저 크기를{' '}
          <span className="font-semibold text-white">
            {RECOMMENDED_WIDTH} × {RECOMMENDED_HEIGHT}
          </span>
          으로 맞추는 걸 권장해요
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-white/50">
          (OBS라면 브라우저 삭제 후 새로 추가해주세요)
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/80">
          <span>현재</span>
          <span className="tabular-nums text-white">
            {Math.round(width)} × {Math.round(height)}
          </span>
          <span className="text-white/40">·</span>
          <span>최소</span>
          <span className="tabular-nums text-white">
            {MIN_WIDTH} × {MIN_HEIGHT}
          </span>
        </div>
      </div>
    </div>
  );
}
