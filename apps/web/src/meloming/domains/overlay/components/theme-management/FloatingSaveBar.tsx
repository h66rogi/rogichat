"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";

interface FloatingSaveBarProps {
  /** dirty 섹션 수 (default + 4개 위젯 중 몇 개가 바뀌었는지) */
  changedCount: number;
  /** 저장 버튼 핸들러 */
  onSave: () => void;
  /** 되돌리기 버튼 핸들러 */
  onReset: () => void;
  /** 뮤테이션 진행 중 여부 */
  isPending: boolean;
}

/**
 * dirty 상태일 때 화면 하단 중앙에 고정되는 플로팅 저장 바.
 *
 * - `pointer-events-none` 래퍼 + 내부 `pointer-events-auto` 콘텐츠로 바깥
 *   영역은 스크롤/클릭을 통과시키고 내부만 인터랙션을 받는다.
 * - 진입 애니메이션은 tailwindcss-animate의 `animate-in slide-in-from-bottom-4`
 *   유틸리티를 사용 (프로젝트 전역에서 이미 활용 중).
 */
export function FloatingSaveBar({
  changedCount,
  onSave,
  onReset,
  isPending,
}: FloatingSaveBarProps) {
  return (
    <div className="fixed bottom-[var(--floating-stack-bottom)] inset-x-0 z-50 flex justify-center pb-[var(--floating-bottom-action-padding)] pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-4 rounded-2xl bg-indigo-600 px-7 py-4 shadow-2xl shadow-indigo-600/40 ring-4 ring-indigo-500/40 animate-in slide-in-from-bottom-8 fade-in duration-300">
        <span className="relative flex size-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
          <span className="relative inline-flex size-2.5 rounded-full bg-white" />
        </span>
        <span className="text-base font-semibold text-white">
          <span className="font-extrabold">{changedCount}개</span> 항목 변경됨
        </span>
        <Button
          size="default"
          onClick={onReset}
          disabled={isPending}
          className="bg-transparent text-white border border-white/50 hover:bg-white/15 hover:text-white"
        >
          되돌리기
        </Button>
        <Button
          size="default"
          onClick={onSave}
          disabled={isPending}
          className="bg-white text-indigo-700 font-bold hover:bg-indigo-50 focus-visible:ring-white"
        >
          {isPending && <Loader2 className="size-4 animate-spin mr-2" />}
          저장
        </Button>
      </div>
    </div>
  );
}
