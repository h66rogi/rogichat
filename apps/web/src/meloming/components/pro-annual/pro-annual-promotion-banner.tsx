"use client";

import Link from "next/link";
import { ArrowRight, Crown, Flame } from "lucide-react";
import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";
import { useActiveSubscriptionPromotion } from "@/meloming/domains/subscription-promotion/hooks/use-active-subscription-promotion";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { calculateSavings } from "@/meloming/domains/subscription-promotion/lib/pricing";
import { PromotionStatusBadge } from "@/meloming/components/pro-annual/promotion-status-badge";
import { cn } from "@/meloming/shared/lib/utils";

const PROMOTION_HREF = "/subscription";

type BannerVariant = "standard" | "compact" | "sidebar" | "inline";

interface ProAnnualPromotionBannerProps {
  /**
   * standard: /subscription 등 large hero 위치 (큰 카드)
   * compact: 마이페이지 등 일반 본문 (한 줄 카드)
   * sidebar: 사이드바 카드 슬롯 (세로형)
   * inline: 좁은 영역의 한 줄 링크 (다이얼로그/섹션 내부)
   */
  variant?: BannerVariant;
  /** 이미 PRO 구독 중인 사용자에게 숨길지 여부 (기본 false) */
  hideForProSubscriber?: boolean;
  /** 외곽 컨테이너 추가 클래스 */
  className?: string;
}

/**
 * 멜로밍 PRO 1년권 프로모션 진행 중일 때 구독 페이지로 유도하는 통합 배너.
 *
 * - feature flag(`proAnnualPromotion2026_04`)와 `useActiveSubscriptionPromotion` 결과 모두 켜져 있을 때만 노출
 * - status === "ENDED" 또는 데이터 없음 → null
 * - hideForProSubscriber=true 이면 현재 PRO 구독자에게는 숨김
 */
export function ProAnnualPromotionBanner({
  variant = "standard",
  hideForProSubscriber = false,
  className,
}: ProAnnualPromotionBannerProps) {
  const flagEnabled = useFeatureFlag("proAnnualPromotion2026_04");
  const { data: promotion } = useActiveSubscriptionPromotion();
  const { isProSubscriber } = useAuth();

  if (!flagEnabled || !promotion) return null;
  if (promotion.status === "ENDED") return null;
  if (hideForProSubscriber && isProSubscriber) return null;

  const isActive = promotion.status === "ACTIVE";
  const currentPrice = isActive ? promotion.currentPrice : null;
  const savings = currentPrice !== null ? calculateSavings(currentPrice) : null;
  const showSlots =
    isActive && promotion.totalRemaining > 0 && promotion.totalRemaining <= 50;

  if (variant === "inline") {
    return (
      <Link
        href={PROMOTION_HREF}
        className={cn(
          "group inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70",
          className,
        )}
      >
        <Flame className="size-3.5" />
        <span>
          PRO 1년권 프로모션{" "}
          {savings && `${savings.discountPercent}% 할인`}
        </span>
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
    );
  }

  if (variant === "sidebar") {
    return (
      <Link
        href={PROMOTION_HREF}
        className={cn(
          "group block rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 p-4 text-white shadow-md shadow-rose-500/20 transition-transform hover:scale-[1.01] active:scale-[0.99]",
          className,
        )}
      >
        <div className="flex items-start gap-2">
          <div className="rounded-lg bg-white/15 p-1.5">
            <Crown className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                프로모션 진행 중
              </span>
            </div>
            <p className="mt-0.5 text-sm font-bold leading-snug">
              PRO 1년권 특가
            </p>
          </div>
        </div>

        {savings ? (
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl font-black leading-none">
              {savings.discountPercent}%
            </span>
            <span className="text-xs font-semibold opacity-90">할인</span>
            {currentPrice !== null && (
              <span className="ml-auto text-xs font-bold tabular-nums">
                {currentPrice.toLocaleString("ko-KR")}원
              </span>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs opacity-90">
            {promotion.status === "NOT_STARTED" ? "곧 오픈" : "지금 확인하기"}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-white/20 pt-2.5 text-[11px]">
          <span className="opacity-90">
            {showSlots
              ? `남은 자리 ${promotion.totalRemaining.toLocaleString("ko-KR")}석`
              : "선착순 한정 특가"}
          </span>
          <span className="inline-flex items-center gap-0.5 font-semibold">
            자세히 보기
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </Link>
    );
  }

  if (variant === "compact") {
    return (
      <Link
        href={PROMOTION_HREF}
        className={cn(
          "group block rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 p-4 text-white shadow-md shadow-rose-500/20 transition-transform hover:scale-[1.005] active:scale-[0.998]",
          className,
        )}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-white/15 p-2">
            <Crown className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                프로모션 진행 중
              </span>
              {showSlots && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold">
                  <Flame className="size-3" />
                  {promotion.totalRemaining.toLocaleString("ko-KR")}석
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm font-bold">
              PRO 1년권 {savings ? `${savings.discountPercent}% 특가` : "프로모션"}
            </p>
          </div>
          {currentPrice !== null && (
            <div className="text-right">
              <p className="text-[10px] opacity-80">최저</p>
              <p className="text-base font-black tabular-nums">
                {currentPrice.toLocaleString("ko-KR")}원
              </p>
            </div>
          )}
          <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </div>
      </Link>
    );
  }

  // standard
  return (
    <Link
      href={PROMOTION_HREF}
      className={cn(
        "group block transition-transform hover:scale-[1.005] active:scale-[0.998]",
        className,
      )}
    >
      <div className="rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 text-white p-6 shadow-lg shadow-rose-500/20">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-90">
              <Flame className="size-4" />
              프로모션 진행 중
            </div>
            <h3 className="mt-1.5 text-lg font-bold md:text-xl">
              🎉 멜로밍 PRO 1년권{" "}
              {savings ? `${savings.discountPercent}% 특가` : "프로모션"}
            </h3>
            <p className="mt-1 text-sm opacity-90">
              {savings && currentPrice !== null
                ? `정가 ${(currentPrice + savings.savingsAmount).toLocaleString("ko-KR")}원 → ${currentPrice.toLocaleString("ko-KR")}원 · ${savings.savingsAmount.toLocaleString("ko-KR")}원 절약`
                : "선착순 한정 특가 — 지금 확인하기"}
            </p>
            {showSlots && (
              <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold">
                <Flame className="size-3" />
                전체 {promotion.totalRemaining.toLocaleString("ko-KR")}자리만 남음!
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <PromotionStatusBadge status={promotion.status} />
            <span className="hidden items-center gap-1 text-sm font-semibold md:inline-flex">
              자세히 보기
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
