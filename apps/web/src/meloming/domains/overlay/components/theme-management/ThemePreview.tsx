"use client";

import { useMemo, useState } from "react";
import { resolveEffectiveThemeIdForWidget } from "./utils";
import { cn } from "@/meloming/shared/lib/utils";
import { Button } from "@/meloming/shared/components/ui/button";
import { useDebounce } from "@/meloming/shared/hooks/use-debounce";
import type {
  UnifiedThemeConfig,
  WidgetType,
} from "@/meloming/domains/channel/apis/overlay-theme";
import { VALID_WIDGET_TYPES } from "@/meloming/domains/channel/apis/overlay-theme";
import { WIDGET_LABELS } from "./utils";

const TRANSPARENT_PREVIEW_BG =
  "linear-gradient(45deg, rgba(148,163,184,0.25) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.25) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.25) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.25) 75%)";

// 위젯별 OBS 권장 크기 (px). StickyUrlCard의 WIDGET_SIZES와 동기화.
const WIDGET_SIZES: Record<WidgetType, { width: number; height: number }> = {
  queue: { width: 350, height: 700 },
  "now-playing": { width: 400, height: 160 },
  setlist: { width: 400, height: 700 },
  "songbook-qr": { width: 360, height: 480 },
};

interface ThemePreviewProps {
  /** 미리보기 iframe 생성을 위한 채널 오버레이 토큰 */
  overlayToken: string | null;
  /** 현재 활성 탭 */
  activeTab: "default" | WidgetType;
  /** 로컬 편집 중인 통합 테마 설정 */
  draft: UnifiedThemeConfig;
  /** 래퍼 클래스 (optional) */
  className?: string;
}

/**
 * 현재 편집 중인 테마/옵션을 iframe으로 실시간 미리보기.
 *
 * - `default` 탭에서는 "재생중" 위젯으로 기본 미리보기하며, 사용자가 셀렉터로
 *   다른 위젯으로 전환할 수 있다.
 * - 위젯 탭(`now-playing` 등)에서는 해당 위젯을 고정으로 미리보기.
 * - 위젯에 override가 설정되어 있으면 `themeId`/`options`를 override 값으로,
 *   아니면 `default` 값으로 URL을 구성.
 * - `options` 직렬화는 300ms 디바운스하여 옵션 편집 중 iframe remount를 방지.
 */
export function ThemePreview({
  overlayToken,
  activeTab,
  draft,
  className,
}: ThemePreviewProps) {
  const overlayBaseUrl = process.env.NEXT_PUBLIC_OVERLAY_BASE_URL;

  // default 탭에서 미리볼 위젯 선택. 위젯 탭에서는 해당 탭의 widgetType을 사용.
  const [defaultPreviewWidget, setDefaultPreviewWidget] =
    useState<WidgetType>("now-playing");
  const previewWidget: WidgetType =
    activeTab === "default" ? defaultPreviewWidget : activeTab;

  const { themeId, options } = useMemo(() => {
    const channelOptions = (draft.default.options ?? {}) as Record<
      string,
      unknown
    >;
    const COMMON_KEYS = [
      "fontFamily",
      "textSize",
      "textWeight",
      "textColor",
      "accentColor",
      "backgroundOpacity",
      "borderOpacity",
      "blurIntensity",
    ] as const;
    const commonSet = new Set<string>(COMMON_KEYS);
    const channelCommon: Record<string, unknown> = {};
    for (const key of COMMON_KEYS) {
      if (key in channelOptions) channelCommon[key] = channelOptions[key];
    }

    if (activeTab === "default") {
      const rawDefault = draft.default.themeId;
      const effectiveDefault = resolveEffectiveThemeIdForWidget(
        null,
        rawDefault,
        previewWidget,
      );
      const channelDefaultMatchesEffective = rawDefault === effectiveDefault;
      return {
        themeId: effectiveDefault,
        options: channelDefaultMatchesEffective ? channelOptions : channelCommon,
      };
    }

    const widgetEntry = draft.widgets[activeTab];
    const isInheriting = !widgetEntry || widgetEntry.themeId === null;
    const rawOverrideThemeId = widgetEntry?.themeId ?? null;
    const rawDefaultThemeId = draft.default.themeId;
    const effectiveThemeId = resolveEffectiveThemeIdForWidget(
      rawOverrideThemeId,
      rawDefaultThemeId,
      activeTab,
    );

    if (isInheriting) {
      // Inherit 모드: raw default가 widget에서 그대로 effective로 사용되는
      // 경우만 channel specific 머지 (legacy remap 시엔 skip).
      const channelDefaultMatchesEffective =
        rawDefaultThemeId === effectiveThemeId;
      if (channelDefaultMatchesEffective) {
        return {
          themeId: effectiveThemeId,
          options: {
            ...channelOptions,
            ...((widgetEntry?.options as Record<string, unknown> | null) ?? {}),
          },
        };
      }
      return {
        themeId: effectiveThemeId,
        options: {
          ...channelCommon,
          ...((widgetEntry?.options as Record<string, unknown> | null) ?? {}),
        },
      };
    }

    // Override 모드 — channel common은 항상 머지. specific은 두 조건 모두 통과해야.
    const sameRawTheme =
      rawOverrideThemeId === null || rawOverrideThemeId === rawDefaultThemeId;
    const channelDefaultMatchesEffective =
      rawDefaultThemeId === effectiveThemeId;
    const shouldMergeSpecific = sameRawTheme && channelDefaultMatchesEffective;
    const channelSpecific: Record<string, unknown> = {};
    if (shouldMergeSpecific) {
      for (const [k, v] of Object.entries(channelOptions)) {
        if (!commonSet.has(k)) channelSpecific[k] = v;
      }
    }

    return {
      themeId: effectiveThemeId,
      options: {
        ...channelCommon,
        ...channelSpecific,
        ...((widgetEntry.options as Record<string, unknown> | null) ?? {}),
      },
    };
    // previewWidget이 deps에 포함돼야 default 탭에서 미리보기 위젯 셀렉터 전환
    // 시 widget-aware remap이 재계산된다 (Iter 6 fix가 widget context를 도입한
    // 이후 필수 dependency).
  }, [activeTab, draft, previewWidget]);

  const debouncedOptions = useDebounce(options, 300);

  const previewUrl = useMemo(() => {
    if (!overlayToken) return null;
    const baseUrl =
      overlayBaseUrl ||
      (typeof window !== "undefined" ? window.location.origin : "");
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
    const optionsJson = (() => {
      try {
        return JSON.stringify(debouncedOptions);
      } catch {
        return "{}";
      }
    })();
    const params = new URLSearchParams({
      preview: "1",
      theme: themeId,
      options: optionsJson,
    });
    return `${normalizedBaseUrl}/overlay/${overlayToken}/widgets/${previewWidget}?${params.toString()}`;
  }, [overlayBaseUrl, overlayToken, themeId, debouncedOptions, previewWidget]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">미리보기</h3>
        {activeTab === "default" && (
          <div className="flex flex-wrap gap-1.5">
            {VALID_WIDGET_TYPES.map((widget) => (
              <Button
                key={widget}
                type="button"
                variant={
                  defaultPreviewWidget === widget ? "default" : "outline"
                }
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setDefaultPreviewWidget(widget)}
              >
                {WIDGET_LABELS[widget]}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div
        className="mx-auto w-full overflow-hidden rounded-2xl border"
        style={{
          maxWidth: `${WIDGET_SIZES[previewWidget].width}px`,
          aspectRatio: `${WIDGET_SIZES[previewWidget].width} / ${WIDGET_SIZES[previewWidget].height}`,
          backgroundImage: TRANSPARENT_PREVIEW_BG,
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
          backgroundColor: "#0f172a",
        }}
      >
        {previewUrl ? (
          <iframe
            key={previewUrl}
            src={previewUrl}
            className="size-full border-0"
            title={`${WIDGET_LABELS[previewWidget]} 미리보기`}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
            오버레이 토큰이 없어 미리보기를 표시할 수 없습니다.
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        * 미리보기는 저장되기 전의 로컬 편집 내용을 반영합니다.
      </p>
    </div>
  );
}
