import type { ReactNode } from 'react';
import Link from 'next/link';

import { cn } from '@/shared/lib/cn';
import { PREVIEW_FIXTURE_MARKER } from './fixtures/catalog';

export const PREVIEW_BANNER_TEXT = 'QA · 화면 미리보기 / 샘플 데이터 · 실제 로그인 및 전송 안 됨';

export const PREVIEW_ENTRIES = [
  { href: '/preview', label: '미리보기 안내' },
  { href: '/preview/chat/fan', label: '팬 채팅' },
  { href: '/preview/chat/streamer', label: '스트리머 채팅' },
  { href: '/preview/settings', label: '내 설정' },
] as const;

/**
 * Frame for every QA preview screen: a persistent banner that states the screen is a sample, plus
 * links between the preview entries. Mirrors the mobile wireframe rule that preview state is UI-only.
 */
export function PreviewFrame({ current, children, fill = false }: { current: string; children: ReactNode; fill?: boolean }) {
  return (
    <div data-preview-root={PREVIEW_FIXTURE_MARKER} className={cn('flex min-w-0 flex-1 flex-col', fill && 'min-h-0')}>
      <div role="status" className="border-b border-line bg-surface-strong px-4 py-2 text-[13px] font-semibold text-ink">
        {PREVIEW_BANNER_TEXT}
      </div>
      <nav aria-label="미리보기 화면" className="flex flex-wrap gap-2 border-b border-line-subtle px-4 py-2">
        {PREVIEW_ENTRIES.map((entry) => {
          const active = entry.href === current;
          return (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center rounded-full border px-3 text-[13px] font-medium',
                active ? 'border-ink bg-ink text-canvas' : 'border-control-border text-ink hover:bg-surface-soft',
              )}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>
      <div className={cn('flex min-w-0 flex-1 flex-col', fill && 'min-h-0')}>{children}</div>
    </div>
  );
}
