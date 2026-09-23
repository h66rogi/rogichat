"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "../ui/badge";
import { cn } from "@/meloming/shared/lib/utils";

interface SectionHeaderV3Props {
  /** 좌측 영역 — 페이지 식별자(아이콘 + 제목 + 부제목 등). */
  brand: ReactNode;
  /** 가운데 영역 — 카테고리 탭/검색 등 (옵션). 없으면 brand/actions 만 좌우로 배치. */
  center?: ReactNode;
  /** 우측 영역 — 액션 버튼/링크 등 (옵션). */
  actions?: ReactNode;
  /** 기본 true. NewShell 사이트 sticky offset 위에 자동 정렬. */
  sticky?: boolean;
  /** true 시 container mx-auto 제약 해제 (전폭). */
  isWide?: boolean;
  className?: string;
}

/**
 * 페이지 상단 공용 헤더 v3.
 *
 * 디자인 베이스: meloming-store StoreHeader (sticky + glass + 3-area grid).
 * 다크 보강: shadcn 토큰 card/muted/accent 가 다크에서 0.205~0.269 좁은 대역에
 *   몰려 명도차가 부족하므로, 헤더 컨테이너/border/내부 강조요소에
 *   알파-화이트(`dark:bg-foreground/x`, `dark:border-foreground/x`) 패턴을 추가해
 *   active pill·원형 버튼 등이 다크 배경에서도 분명하게 떠오르도록 함.
 */
export function SectionHeaderV3({
  brand,
  center,
  actions,
  sticky = true,
  isWide = false,
  className,
}: SectionHeaderV3Props) {
  return (
    <header
      data-section-header-v3=""
      className={cn(
        "z-30 border-b border-border bg-background/85 backdrop-blur",
        "supports-[backdrop-filter]:bg-background/70",
        "dark:bg-card/70 dark:border-foreground/10",
        "dark:supports-[backdrop-filter]:bg-card/60",
        // Shell scope 가 실제 상단 chrome 형태에 맞는 offset 을 제공한다.
        sticky && "sticky top-[var(--site-sticky-top)]",
        className
      )}
    >
      <div
        className={cn(
          "px-4 py-3",
          isWide ? "w-full" : "container mx-auto"
        )}
      >
        <div
          className={cn(
            "grid min-h-9 items-center gap-3",
            center
              ? "grid-cols-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
              : "grid-cols-[1fr_auto]"
          )}
        >
          <div className="row-start-1 col-start-1 flex items-center min-w-0">
            {brand}
          </div>
          {center && (
            <div className="col-span-2 row-start-2 mt-2 flex justify-center sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:mt-0">
              {center}
            </div>
          )}
          {actions && (
            <div
              className={cn(
                "row-start-1 flex items-center justify-end gap-1",
                center ? "col-start-2 sm:col-start-3" : "col-start-2"
              )}
            >
              {actions}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

interface BrandIconTitleProps {
  title: string;
  /** 메인 title 옆에 노출되는 sub title. */
  subtitle?: string;
  icon: LucideIcon;
  /** 클릭 시 이동할 경로. onBackClick 있으면 무시. */
  link?: string;
  isBeta?: boolean;
  onBackClick?: () => void;
}

/**
 * v3 의 brand 슬롯에 넣는 표준 좌측 위젯.
 * v2 의 icon + title + subtitle + isBeta + link/onBackClick 와 1:1 호환.
 */
export function BrandIconTitle({
  title,
  subtitle,
  icon: Icon,
  link,
  isBeta,
  onBackClick,
}: BrandIconTitleProps) {
  const router = useRouter();
  const clickable = !!(onBackClick || link);

  const handleActivate = () => {
    if (onBackClick) onBackClick();
    else if (link) router.push(link);
  };

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center gap-2 min-w-0 text-lg font-bold tracking-tight text-foreground sm:text-xl",
        clickable && "cursor-pointer transition-colors hover:text-foreground/80"
      )}
      onClick={clickable ? handleActivate : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleActivate();
              }
            }
          : undefined
      }
    >
      <Icon className="size-5 shrink-0 sm:size-6" />
      <span className="truncate">{title}</span>
      {isBeta && <Badge variant="default">BETA</Badge>}
      {subtitle ? (
        <>
          <span
            aria-hidden
            className="hidden font-normal text-muted-foreground md:inline"
          >
            /
          </span>
          <span
            className="truncate text-sm font-semibold text-muted-foreground sm:text-base"
            title={subtitle}
          >
            {subtitle}
          </span>
        </>
      ) : null}
    </div>
  );
}
