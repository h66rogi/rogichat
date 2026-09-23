'use client';

import { X, Lightbulb } from 'lucide-react';
import { useDismissible } from '@/meloming/domains/overlay/hooks/use-onboarding';
import { cn } from '@/meloming/shared/lib/utils';

interface ContextualHintProps {
  /** localStorage에 저장될 고유 키 */
  hintKey: string;
  /** 힌트 메시지 */
  children: React.ReactNode;
  /** 추가 className */
  className?: string;
}

/**
 * 처음 방문 시 표시되는 간결한 힌트 카드.
 * 닫으면 localStorage에 기록되어 다시 표시되지 않음.
 */
export function ContextualHint({ hintKey, children, className }: ContextualHintProps) {
  const { dismissed, dismiss } = useDismissible(hintKey);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        'relative flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 mb-6',
        className,
      )}
    >
      <Lightbulb className="size-4 text-primary mt-0.5 shrink-0" />
      <div className="flex-1 text-sm text-muted-foreground leading-relaxed">
        {children}
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
        aria-label="닫기"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
