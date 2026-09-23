"use client";

import { useId } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

export interface SectionHeaderTabItem {
  /** 활성 판정 + onValueChange 인자로 쓰이는 고유 키. */
  value: string;
  label: string;
  /** 라벨 앞 아이콘 (옵션). */
  icon?: LucideIcon;
  /** 지정 시 <Link> 로 라우팅, 미지정 시 onValueChange 버튼으로 동작. */
  href?: string;
}

interface SectionHeaderTabsProps {
  items: SectionHeaderTabItem[];
  /** 현재 활성 탭의 value. */
  value: string;
  /** 버튼 모드 — value 변경 콜백. href 가 있는 item 은 Link 클릭 시에도 함께 호출된다. */
  onValueChange?: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * SectionHeaderV3 의 center 슬롯에 넣는 표준 카테고리 탭.
 *
 * 시각 기준(canonical reference): meloming-store StoreHeader 의 CategoryTabs —
 * `rounded-full bg-muted p-1` 컨테이너 + `rounded-full` pill + `motion.span` 슬라이딩
 * active 인디케이터. StoreHeader 는 도메인 전용 위젯이라 자체 구현을 유지하고, 그 외
 * center 탭이 필요한 페이지(커미션/랭킹 등)는 이 공용 컴포넌트로 동일한 모양을 맞춘다.
 *
 * layoutId 는 useId 로 인스턴스마다 유니크하게 잡아, 한 화면에 헤더 탭이 둘 이상이어도
 * active pill 이 서로 끌려가지 않게 한다. (StoreHeader 의 고정 layoutId 와도 충돌 X.)
 */
export function SectionHeaderTabs({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
}: SectionHeaderTabsProps) {
  const layoutId = useId();
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-9 items-center gap-1 rounded-full bg-muted p-1 text-muted-foreground",
        className
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        const Icon = item.icon;
        const triggerClass = cn(
          "relative isolate inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors",
          active ? "text-foreground" : "hover:text-foreground"
        );
        const inner = (
          <>
            {active && (
              <motion.span
                layoutId={layoutId}
                aria-hidden
                initial={false}
                className={cn(
                  "absolute inset-0 -z-10 rounded-full bg-background shadow-sm",
                  "dark:bg-foreground/10 dark:ring-1 dark:ring-foreground/15 dark:shadow-none"
                )}
                transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
              />
            )}
            {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
            {item.label}
          </>
        );

        if (item.href) {
          return (
            <Link
              key={item.value}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={triggerClass}
              onClick={onValueChange ? () => onValueChange(item.value) : undefined}
            >
              {inner}
            </Link>
          );
        }

        return (
          <button
            key={item.value}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onValueChange?.(item.value)}
            className={triggerClass}
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
}
