'use client';

import { MessageSquare, ListMusic, Monitor, ArrowRight } from 'lucide-react';
import { useDismissible } from '@/meloming/domains/overlay/hooks/use-onboarding';
import { X } from 'lucide-react';
import { cn } from '@/meloming/shared/lib/utils';

const FLOW_ITEMS = [
  {
    icon: MessageSquare,
    label: '시청자가 노래 신청',
    color: 'text-indigo-500',
    bg: 'bg-indigo-500/10',
  },
  {
    icon: ListMusic,
    label: '대기열에 추가',
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
  {
    icon: Monitor,
    label: '방송 화면에 표시',
    color: 'text-green-500',
    bg: 'bg-green-500/10',
  },
];

const FEATURES = [
  { label: '신청곡 설정', desc: '신청 규칙, 참고 가격, 대기열 크기 등을 조절' },
  { label: '오버레이', desc: 'OBS 방송 화면에 표시될 위젯 디자인' },
  { label: '리모컨 (신청곡 콘솔)', desc: '방송 중 신청곡 수락/거절/순서 관리' },
];

/**
 * 기능 관계도: 신청곡 → 대기열 → 오버레이 흐름을 시각적으로 보여줌
 */
export function FeatureFlow() {
  const { dismissed, dismiss } = useDismissible('feature_flow');

  if (dismissed) return null;

  return (
    <div className="relative rounded-2xl border bg-muted/20 p-5 mb-6">
      {/* 닫기 */}
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
        aria-label="닫기"
      >
        <X className="size-4" />
      </button>

      <h4 className="text-sm font-semibold mb-4">이렇게 동작해요</h4>

      {/* 흐름도 */}
      <div className="flex items-center justify-center gap-2 sm:gap-4 mb-5">
        {FLOW_ITEMS.map((item, idx) => (
          <div key={item.label} className="contents">
            <div className="flex flex-col items-center gap-1.5">
              <div className={cn('size-10 sm:size-12 rounded-2xl flex items-center justify-center', item.bg)}>
                <item.icon className={cn('size-5 sm:size-6', item.color)} />
              </div>
              <span className="text-xs text-center leading-tight max-w-[80px]">{item.label}</span>
            </div>
            {idx < FLOW_ITEMS.length - 1 && (
              <ArrowRight className="size-4 text-muted-foreground/50 shrink-0 mt-[-12px]" />
            )}
          </div>
        ))}
      </div>

      {/* 각 기능 설명 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {FEATURES.map((f) => (
          <div key={f.label} className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground shrink-0">{f.label}</span>
            <span>{f.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
