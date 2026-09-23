"use client";

import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

/**
 * SectionHeaderV3 actions(우측) 슬롯 표준 pill 버튼 className.
 *
 * 시각 기준(canonical reference): 노래책 MusicbookQuickNav / 선물하기 AnongiftQuickNav —
 * `rounded-full border px-2.5 text-xs` pill, active=primary 채움, inactive=muted 외곽선.
 * 두 reference 는 도메인 전용이라 자체 구현을 유지하고, 그 외 모든 헤더 우측 버튼
 * (외부 이동 / 편집 / 안내 / 이용 규정 등)은 이 유틸/컴포넌트로 동일한 모양에 맞춘다.
 *
 * shadcn <Button> 의 outline/secondary/ghost variant 를 헤더 actions 에 직접 쓰면
 * 페이지마다 모서리·높이·색이 달라지므로, 헤더 안에서는 이 pill 만 사용한다.
 */
export function sectionHeaderPillClass(active?: boolean): string {
  return cn(
    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition sm:px-3",
    active
      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
  );
}

interface SectionHeaderActionLinkProps {
  href: string;
  label: string;
  /** 라벨 앞 아이콘 (옵션). */
  icon?: LucideIcon;
  /** 외부 링크 — 새 탭 + 라벨 뒤 ArrowUpRight 표식. */
  external?: boolean;
  /** primary 채움 (주요 CTA). */
  active?: boolean;
  /** 모바일에서 라벨 숨김(아이콘만 노출). 기본 true — 노래책/선물하기 pill 패턴과 일치. */
  hideLabelOnMobile?: boolean;
  className?: string;
}

/**
 * 헤더 actions 슬롯의 표준 pill 링크. 내부 라우팅(Link) / 외부 이동(a) 둘 다 지원.
 * 단일 동작 버튼(Dialog trigger 등)은 sectionHeaderPillClass() 를 직접 적용한다.
 */
export function SectionHeaderActionLink({
  href,
  label,
  icon: Icon,
  external = false,
  active = false,
  hideLabelOnMobile = true,
  className,
}: SectionHeaderActionLinkProps) {
  const cls = cn(sectionHeaderPillClass(active), className);
  const inner = (
    <>
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      <span className={hideLabelOnMobile ? "hidden sm:inline" : undefined}>
        {label}
      </span>
      {external ? <ArrowUpRight className="size-3.5 shrink-0" aria-hidden /> : null}
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        className={cls}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link href={href} aria-label={label} className={cls}>
      {inner}
    </Link>
  );
}
