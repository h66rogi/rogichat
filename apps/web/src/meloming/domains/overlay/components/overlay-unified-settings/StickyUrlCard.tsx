"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { Input } from "@/meloming/shared/components/ui/input";
import { cn } from "@/meloming/shared/lib/utils";
import { OVERLAY_TAB_LABELS, type OverlayTabId } from "./tabs";
import { OverlayCopyGuideDialog } from "../overlay-copy-guide-dialog";

/**
 * 위젯 OBS 권장 크기 (px).
 * overview/default 탭은 URL 소유가 없어 `total`로 fallback한다.
 */
const WIDGET_SIZES: Record<
  Exclude<OverlayTabId, "overview" | "default">,
  { width: number; height: number }
> = {
  queue: { width: 350, height: 700 },
  "now-playing": { width: 400, height: 160 },
  setlist: { width: 400, height: 700 },
  "songbook-qr": { width: 360, height: 480 },
  total: { width: 1920, height: 1080 },
};

/** overview/default 탭에서도 URL 카드를 "통합 오버레이"로 노출 */
const URL_FALLBACK_TAB: Record<
  "overview" | "default",
  Exclude<OverlayTabId, "overview" | "default">
> = {
  overview: "total",
  default: "total",
};

interface StickyUrlCardProps {
  tab: OverlayTabId;
  overlayToken: string | null;
}

/**
 * 탭별 OBS URL 카드.
 * overview/default 탭은 "통합 오버레이" URL을 노출한다.
 * overlayToken이 없으면 "토큰 생성 필요" 안내 카드.
 */
export function StickyUrlCard({ tab, overlayToken }: StickyUrlCardProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [obsGuideUrl, setObsGuideUrl] = useState<string | null>(null);

  // position:sticky 가 아니라 isStuck 시 position:fixed 로 전환한다.
  // Radix Dropdown/Dialog/Select 류가 열리면 react-remove-scroll 이 body 의
  // overflow/position 을 잠가 sticky containing block 이 viewport→body 로
  // 재할당되며 sticky element 가 scrollY 만큼 viewport 위로 튀어 사라진다.
  // sentinel(in-flow 0-height div) 의 위치/너비를 측정해 fixed 시에도 부모 컨테이너
  // 정렬을 그대로 보존하고, placeholder 로 in-flow 자리를 채워 layout shift 차단.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);
  const [cardHeight, setCardHeight] = useState(0);
  const [bounds, setBounds] = useState<{ left: number; width: number } | null>(
    null,
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const getStickyTop = () =>
      parseFloat(
        getComputedStyle(sentinel).getPropertyValue(
          "--page-content-sticky-top",
        ),
      ) || 0;
    const measure = () => {
      const rect = sentinel.getBoundingClientRect();
      setBounds({ left: rect.left, width: rect.width });
      setIsStuck(rect.top <= getStickyTop());
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(sentinel);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measureH = () => setCardHeight(el.getBoundingClientRect().height);
    measureH();
    const ro = new ResizeObserver(measureH);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // overview/default 탭은 통합 오버레이 URL로 폴백
  const urlTab: Exclude<OverlayTabId, "overview" | "default"> =
    tab === "overview" || tab === "default"
      ? URL_FALLBACK_TAB[tab]
      : tab;

  const sizes = WIDGET_SIZES[urlTab];
  const title = OVERLAY_TAB_LABELS[urlTab];
  const overlayBaseUrl = process.env.NEXT_PUBLIC_OVERLAY_BASE_URL;

  const baseUrl =
    overlayBaseUrl ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const url = overlayToken
    ? `${normalizedBase}/overlay/${overlayToken}/widgets/${urlTab}`
    : "";

  const handleCopy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setObsGuideUrl(url);
    setTimeout(() => setCopied(false), 2000);
  };

  const cardClassName = cn(
    "py-0 z-40 bg-background/95 backdrop-blur",
    isStuck && "fixed top-[var(--page-content-sticky-top)]",
  );
  const cardStyle =
    isStuck && bounds
      ? { left: `${bounds.left}px`, width: `${bounds.width}px` }
      : undefined;

  const inner = !overlayToken ? (
    <CardContent className="px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
          {title}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        오버레이 주소를 먼저 생성해주세요. (개요 탭 → 주소 재생성)
      </p>
    </CardContent>
  ) : (
    <CardContent className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
          {title}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>권장</span>
          <span className="font-mono bg-muted px-1.5 py-0.5 rounded">
            {sizes.width}
          </span>
          <span>×</span>
          <span className="font-mono bg-muted px-1.5 py-0.5 rounded">
            {sizes.height}
          </span>
          <span>px</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className="relative flex-1 cursor-pointer"
          onClick={() => !revealed && setRevealed(true)}
        >
          <Input
            readOnly
            value={url}
            className={cn(
              "font-mono text-xs transition-[filter] duration-200",
              !revealed && "blur-[6px] select-none",
            )}
          />
          {!revealed && (
            <div className="absolute inset-0 flex items-center justify-center gap-1.5 pointer-events-none">
              <Eye className="size-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">
                클릭하여 URL 표시
              </span>
            </div>
          )}
        </div>
        <Button size="icon" variant="outline" onClick={handleCopy}>
          {copied ? (
            <Check className="size-4 text-green-500" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
      </div>
    </CardContent>
  );

  return (
    <>
      <div ref={sentinelRef} aria-hidden style={{ height: 0 }} />
      {isStuck && <div aria-hidden style={{ height: cardHeight }} />}
      <Card ref={cardRef} className={cardClassName} style={cardStyle}>
        {inner}
      </Card>
      {overlayToken && (
        <OverlayCopyGuideDialog
          open={obsGuideUrl !== null}
          onOpenChange={(next) => {
            if (!next) setObsGuideUrl(null);
          }}
          url={obsGuideUrl ?? ""}
          widgetName={title}
          width={sizes.width}
          height={sizes.height}
        />
      )}
    </>
  );
}
