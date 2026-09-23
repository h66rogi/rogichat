'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, MonitorPlay } from 'lucide-react';
import { cn } from '@/meloming/shared/lib/utils';

interface OBSSetupGuideProps {
  width: number;
  height: number;
  widgetName: string;
}

/**
 * OBS 연동 시각적 스텝 가이드.
 * URL은 외부에서 별도로 표시하고, 이 컴포넌트는 순수 가이드 역할.
 */
export function OBSSetupGuide({ width, height, widgetName }: OBSSetupGuideProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border bg-muted/10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/20 transition-colors rounded-xl"
      >
        <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <MonitorPlay className="size-4.5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium">OBS 연결 가이드</div>
          <div className="text-xs text-muted-foreground">
            브라우저 소스로 추가하는 방법
          </div>
        </div>
        <ChevronDown
          className={cn(
            'size-4 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          <div className="h-px bg-border" />

          {/* Step 1 */}
          <div className="flex gap-3">
            <div className="flex items-center justify-center size-7 rounded-lg bg-muted text-xs font-bold shrink-0">
              1
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">OBS에서 소스 추가</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                소스 목록에서 <span className="font-medium text-foreground">+</span> 버튼 →{' '}
                <span className="font-medium text-foreground">브라우저</span> 선택
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3">
            <div className="flex items-center justify-center size-7 rounded-lg bg-muted text-xs font-bold shrink-0">
              2
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">URL 붙여넣기</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                위에서 복사한 URL을 브라우저 소스의 URL 필드에 붙여넣으세요
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3">
            <div className="flex items-center justify-center size-7 rounded-lg bg-muted text-xs font-bold shrink-0">
              3
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">크기 설정</p>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                너비와 높이를 아래 권장 크기로 설정하세요
              </p>
              <div className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5">
                <span className="text-xs text-muted-foreground">너비</span>
                <span className="font-mono text-sm font-medium">{width}</span>
                <span className="text-xs text-muted-foreground mx-1">x</span>
                <span className="text-xs text-muted-foreground">높이</span>
                <span className="font-mono text-sm font-medium">{height}</span>
              </div>
            </div>
          </div>

          {/* Step 4 */}
          <div className="flex gap-3">
            <div className="flex items-center justify-center size-7 rounded-lg bg-green-500/15 text-xs font-bold text-green-600 shrink-0">
              ✓
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">완료!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                확인을 누르면 {widgetName}이(가) 방송 화면에 나타납니다.
                배경은 기본적으로 투명이라 자연스럽게 합쳐져요.
              </p>
            </div>
          </div>

          {/* OBS 버전 요구사항 */}
          <div className="flex gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-amber-600 dark:text-amber-400">OBS 31.0.0 이상</span>에서만
              배경 투명 처리가 정상 작동합니다. 이전 버전에서는 배경이 까맣게 표시될 수 있습니다.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
