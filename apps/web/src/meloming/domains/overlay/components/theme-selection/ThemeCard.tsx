'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/meloming/shared/lib/utils';
import type { ThemeCatalogEntry } from '@/meloming/domains/channel/apis/overlay-theme';

export type ThemeBadge = 'default' | 'recommended';

const THEME_BADGES: Record<string, ThemeBadge[]> = {
  apple: ['default', 'recommended'],
  spotify: ['recommended'],
  'concert-poster': ['recommended'],
  glassmorphism: ['recommended'],
  kawaii: ['recommended'],
};

const BADGE_CONFIG: Record<ThemeBadge, { label: string; className: string }> = {
  default: {
    label: '기본',
    className: 'bg-primary text-primary-foreground',
  },
  recommended: {
    label: '추천',
    className: 'bg-amber-500 text-white',
  },
};

export function getThemeBadges(themeId: string): ThemeBadge[] {
  return THEME_BADGES[themeId] ?? [];
}

interface ThemeCardProps {
  theme: ThemeCatalogEntry;
  selected: boolean;
  onClick: () => void;
}

/**
 * 단일 테마 미리보기 카드.
 *
 * 썸네일 이미지가 아직 존재하지 않는 단계에서는(Phase 5.3에서 생성)
 * 이미지 로드 실패 시 테마 이름을 가진 fallback 그라데이션을 보여준다.
 */
export function ThemeCard({ theme, selected, onClick }: ThemeCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const badges = getThemeBadges(theme.id);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${theme.name} 테마 선택`}
      className={cn(
        'group relative flex flex-col rounded-xl border-2 bg-card text-left transition-all overflow-hidden',
        'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        selected
          ? 'border-primary ring-2 ring-primary/20 shadow-sm'
          : 'border-border hover:border-primary/50'
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {!imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={theme.thumbnail}
            alt={`${theme.name} 미리보기`}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <ThemeThumbnailFallback name={theme.name} themeId={theme.id} />
        )}

        {/* Badges */}
        {badges.length > 0 && (
          <div className="absolute left-2 top-2 flex gap-1">
            {badges.map((badge) => (
              <span
                key={badge}
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-tight shadow-sm',
                  BADGE_CONFIG[badge].className
                )}
              >
                {BADGE_CONFIG[badge].label}
              </span>
            ))}
          </div>
        )}

        {/* Selected indicator */}
        {selected && (
          <div className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
            <Check className="size-4" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h4 className="text-sm font-semibold leading-tight">{theme.name}</h4>
      </div>
    </button>
  );
}

/**
 * 썸네일 이미지가 로드 실패했을 때 보여주는 fallback.
 * 테마 ID 기반으로 결정적인 그라데이션을 생성한다.
 */
function ThemeThumbnailFallback({
  name,
  themeId,
}: {
  name: string;
  themeId: string;
}) {
  const gradient = generateGradientFromId(themeId);

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ background: gradient }}
    >
      <span className="px-3 text-center text-sm font-semibold text-white drop-shadow-md">
        {name}
      </span>
    </div>
  );
}

/**
 * 테마 ID 문자열로부터 결정적인 그라데이션 색상을 생성한다.
 * 같은 ID는 항상 같은 색상을 반환하여 시각적 식별성을 유지한다.
 */
function generateGradientFromId(themeId: string): string {
  let hash = 0;
  for (let i = 0; i < themeId.length; i += 1) {
    hash = themeId.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 65% 40%), hsl(${hue2} 65% 30%))`;
}
