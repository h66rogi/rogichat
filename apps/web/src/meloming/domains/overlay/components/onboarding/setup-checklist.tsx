'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Check, ChevronRight, ListOrdered, Palette, Monitor, X } from 'lucide-react';
import { useDismissible, type SetupStatus } from '@/meloming/domains/overlay/hooks/use-onboarding';
import { cn } from '@/meloming/shared/lib/utils';

interface SetupChecklistProps {
  status: SetupStatus;
}

const STEPS = [
  {
    key: 'song-request' as const,
    label: '신청곡 설정',
    description: '신청곡 받기, 대기열 크기 등 기본 설정',
    icon: ListOrdered,
    href: (user: string) => `/channel/${user}/manage/song-request-settings`,
    isComplete: (s: SetupStatus) => s.hasActiveSession,
  },
  {
    key: 'overlay-theme' as const,
    label: '오버레이 꾸미기',
    description: '테마와 레이아웃 선택',
    icon: Palette,
    href: (user: string) => `/channel/${user}/manage/overlay-settings`,
    isComplete: (s: SetupStatus) => s.hasCustomTheme,
  },
  {
    key: 'obs-connect' as const,
    label: 'OBS에 연결',
    description: 'URL을 복사해서 OBS에 추가',
    icon: Monitor,
    href: (user: string) => `/channel/${user}/manage/overlay-settings`,
    isComplete: (s: SetupStatus) => s.hasToken && s.hasCustomTheme,
  },
];

export function SetupChecklist({ status }: SetupChecklistProps) {
  const params = useParams();
  const user = params?.user as string;
  const { dismissed, dismiss } = useDismissible('setup_checklist');

  if (dismissed || status.isLoading) return null;

  const completedCount = STEPS.filter((step) => step.isComplete(status)).length;
  const allDone = completedCount === STEPS.length;

  if (allDone) return null;

  const nextStep = STEPS.find((step) => !step.isComplete(status));

  return (
    <div className="relative rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/5 via-background to-indigo-500/5 p-5">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
        aria-label="닫기"
      >
        <X className="size-4" />
      </button>

      <div className="mb-4">
        <h3 className="text-base font-semibold">신청곡 & 오버레이 시작하기</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          아래 단계를 따라가면 방송에서 바로 사용할 수 있어요
        </p>
      </div>

      <div className="h-1.5 rounded-full bg-muted mb-5">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${(completedCount / STEPS.length) * 100}%` }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {STEPS.map((step, idx) => {
          const done = step.isComplete(status);
          const isNext = step === nextStep;

          return (
            <Link
              key={step.key}
              href={step.href(user)}
              className={cn(
                'group flex items-start gap-3 rounded-xl border p-3.5 transition-all',
                done
                  ? 'border-green-500/30 bg-green-500/5'
                  : isNext
                    ? 'border-indigo-500/40 bg-indigo-500/5 hover:border-indigo-500/60 hover:-translate-y-0.5 hover:shadow-sm'
                    : 'border-border/50 bg-muted/20 opacity-60',
              )}
            >
              <div
                className={cn(
                  'flex items-center justify-center size-8 rounded-lg shrink-0 text-sm font-semibold',
                  done
                    ? 'bg-green-500/15 text-green-600'
                    : isNext
                      ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="size-4" /> : idx + 1}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn('text-sm font-medium', done && 'text-green-600')}>
                    {step.label}
                  </span>
                  {isNext && (
                    <ChevronRight className="size-3.5 text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {done ? '완료' : step.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
