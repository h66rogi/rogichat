"use client";

import { useMemo } from "react";
import { Checkbox } from "@/meloming/shared/components/ui/checkbox";
import { Separator } from "@/meloming/shared/components/ui/separator";
import { Switch } from "@/meloming/shared/components/ui/switch";
import { ThemeGrid } from "@/meloming/domains/overlay/components/theme-selection";
import { DynamicOptionForm } from "@/meloming/domains/overlay/components/theme-settings/dynamic-form/DynamicOptionForm";
import type {
  ThemeCatalogEntry,
  UnifiedThemeConfig,
  WidgetType,
} from "@/meloming/domains/channel/apis/overlay-theme";
import { WIDGET_LABELS, resolveEffectiveThemeIdForWidget } from "./utils";
import { SettingsRow } from "@/meloming/shared/components/common/settings-form";

/**
 * 백엔드 resolveForOverlay와 동일한 머지 정책을 폼/프리뷰에 미러링하기 위한
 * common option key. theme-agnostic이라 widget override 모드에서도 채널 공통
 * 값이 항상 적용된다.
 */
const COMMON_OPTION_KEYS: ReadonlySet<string> = new Set([
  "fontFamily",
  "textSize",
  "textWeight",
  "textColor",
  "accentColor",
  "backgroundOpacity",
  "borderOpacity",
  "blurIntensity",
]);

/**
 * Wrapper-level 공통 옵션 키. 테마 카탈로그의 optionSchema에 정의되지 않고
 * 위젯이 어떤 테마를 쓰든 동일하게 적용되는 옵션(자동 스크롤, 앨범아트 표시
 * 등). 테마 변경/상속 토글 시에도 보존되며 상속 모드에서도 편집 가능하다.
 */
const WRAPPER_OPTION_KEYS: readonly string[] = [
  "autoScrollEnabled",
  "showAlbumArt",
];

function readBooleanOption(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  if (typeof value === "number") return value !== 0;
  return false;
}

interface WidgetTabContentProps {
  /** 이 탭이 편집 대상으로 삼는 위젯 타입 */
  widgetType: WidgetType;
  /** 로컬 편집 중인 통합 설정 */
  draft: UnifiedThemeConfig;
  /** 설정 변경 핸들러 */
  onChange: (next: UnifiedThemeConfig) => void;
  /** 테마 카탈로그 */
  catalog: ThemeCatalogEntry[];
}

/**
 * 위젯 탭 콘텐츠.
 *
 * 상속 여부는 `entry.themeId`로만 판정한다.
 * 1. **상속 모드**: `themeId === null`. 채널 기본 테마가 적용되며 테마 옵션
 *    폼은 숨겨진다. `options`에 wrapper-level 공통 옵션(앨범아트 표시 등)이
 *    들어 있어도 상속 모드가 유지된다.
 * 2. **오버라이드 모드**: `themeId !== null`. 위젯별 테마와 테마 옵션을 자유
 *    롭게 설정한다.
 *
 * wrapper-level 공통 옵션(`WRAPPER_OPTION_KEYS`)은 테마에 종속되지 않으므로
 * 두 모드 모두에서 편집 가능하며, 테마 변경/모드 전환 시에도 보존된다.
 */
export function WidgetTabContent({
  widgetType,
  draft,
  onChange,
  catalog,
}: WidgetTabContentProps) {
  const entry = draft.widgets[widgetType] ?? {
    themeId: null,
    options: null,
  };

  // 상속 모드 판정은 themeId 기준. options에 wrapper-level 공통 옵션만
  // 저장돼 있어도 테마 자체는 채널 기본을 상속한다.
  const isInheriting = entry.themeId === null;

  const rawDefaultThemeId = draft.default.themeId;
  const rawOverrideThemeId = entry.themeId;
  const effectiveThemeId = resolveEffectiveThemeIdForWidget(
    rawOverrideThemeId,
    rawDefaultThemeId,
    widgetType,
  );

  const effectiveTheme = useMemo<ThemeCatalogEntry | undefined>(
    () => catalog.find((theme) => theme.id === effectiveThemeId),
    [catalog, effectiveThemeId],
  );

  // Backend resolveForOverlay 머지 정책 mirror:
  //   catalog default ← channel common (always) ← (조건적) channel specific ← widget override
  // 머지 조건은 sameRawTheme(rawOverride null 또는 raw default) AND
  // channelDefaultMatchesEffective(legacy remap 안 일어남) 둘 다 true.
  const effectiveOptions = useMemo<Record<string, unknown>>(() => {
    const catalogDefaults =
      (effectiveTheme?.defaultOptions as Record<string, unknown>) ?? {};
    const channelOptions = (draft.default.options ?? {}) as Record<
      string,
      unknown
    >;
    const channelCommon: Record<string, unknown> = {};
    for (const key of COMMON_OPTION_KEYS) {
      if (key in channelOptions) channelCommon[key] = channelOptions[key];
    }
    const sameRawTheme =
      rawOverrideThemeId === null || rawOverrideThemeId === rawDefaultThemeId;
    const channelDefaultMatchesEffective =
      rawDefaultThemeId === effectiveThemeId;
    const shouldMergeChannelSpecific =
      sameRawTheme && channelDefaultMatchesEffective;
    const channelSpecific: Record<string, unknown> = {};
    if (shouldMergeChannelSpecific) {
      for (const [key, value] of Object.entries(channelOptions)) {
        if (!COMMON_OPTION_KEYS.has(key)) channelSpecific[key] = value;
      }
    }
    return {
      ...catalogDefaults,
      ...channelCommon,
      ...channelSpecific,
      ...((entry.options as Record<string, unknown> | null) ?? {}),
    };
  }, [
    effectiveTheme?.defaultOptions,
    draft.default.options,
    rawDefaultThemeId,
    rawOverrideThemeId,
    effectiveThemeId,
    entry.options,
  ]);

  const handleToggleInherit = (checked: boolean) => {
    // 테마 상속 토글은 wrapper-level 공통 옵션(앨범아트 표시 등)을 건드리지
    // 않는다. 두 방향 모두에서 기존 값을 유지한다.
    const currentOptions =
      (entry.options as Record<string, unknown> | null) ?? {};
    const preservedWrapper: Record<string, unknown> = {};
    for (const key of WRAPPER_OPTION_KEYS) {
      if (key in currentOptions) preservedWrapper[key] = currentOptions[key];
    }
    const hasWrapper = Object.keys(preservedWrapper).length > 0;

    if (checked) {
      // 상속 모드로: 테마 오버라이드만 해제하고 wrapper 옵션은 남긴다.
      onChange({
        ...draft,
        widgets: {
          ...draft.widgets,
          [widgetType]: {
            themeId: null,
            options: hasWrapper ? preservedWrapper : null,
          },
        },
      });
    } else {
      // 오버라이드 모드로: 채널 기본 테마를 시드로 + wrapper 옵션 보존.
      // forced default 가 있는 위젯은 채널 default 가 아닌
      // forced default 를 시드로 — 사용자가 인히어리트 상태에서 보던 테마
      // 그대로 override 모드 시작.
      const seedThemeId = resolveEffectiveThemeIdForWidget(
        null,
        draft.default.themeId,
        widgetType,
      );
      onChange({
        ...draft,
        widgets: {
          ...draft.widgets,
          [widgetType]: {
            themeId: seedThemeId,
            options: preservedWrapper,
          },
        },
      });
    }
  };

  const handleThemeSelect = (themeId: string) => {
    if (isInheriting) return; // 상속 모드에서는 선택 불가 (UI가 렌더되지 않음)
    // 사용자가 명시 선택한 테마는 그대로 override 로 박는다 — forced default
    // 가 있어도 사용자 선택 우선.
    if (themeId === entry.themeId) return;
    const nextTheme = catalog.find((theme) => theme.id === themeId);
    const defaultOptions = nextTheme?.defaultOptions ?? {};
    // wrapper-level 공통 옵션(자동 스크롤, 앨범아트 표시 등)은 테마 카탈로그
    // optionSchema에 정의되지 않으므로 테마 변경 시 명시적으로 보존해야 한다.
    const preservedCommon: Record<string, unknown> = {};
    const existing = (entry.options ?? {}) as Record<string, unknown>;
    for (const key of WRAPPER_OPTION_KEYS) {
      if (key in existing) preservedCommon[key] = existing[key];
    }
    onChange({
      ...draft,
      widgets: {
        ...draft.widgets,
        [widgetType]: {
          themeId,
          options: { ...defaultOptions, ...preservedCommon },
        },
      },
    });
  };

  const handleOptionChange = (key: string, value: unknown) => {
    // 빈 문자열/undefined는 backend sanitize에 의해 strip되므로 클라도 같은
    // 의미(=key 삭제)로 처리해 dirty/save bar 동기화 일관성 유지.
    const nextOptions: Record<string, unknown> = {
      ...((entry.options as Record<string, unknown> | null) ?? {}),
    };
    if (value === '' || value === undefined) {
      delete nextOptions[key];
    } else {
      nextOptions[key] = value;
    }

    // 상속 모드에서는 themeId를 null로 유지해 테마 상속을 지킨다. 오버라이드
    // 모드에서는 사용자가 명시 선택한 entry.themeId 를 그대로 유지한다.
    const nextThemeId = entry.themeId;

    // 상속 모드에서 옵션까지 비면 완전 상속(options: null)으로 되돌린다.
    const shouldFullyInherit =
      nextThemeId === null && Object.keys(nextOptions).length === 0;

    onChange({
      ...draft,
      widgets: {
        ...draft.widgets,
        [widgetType]: shouldFullyInherit
          ? { themeId: null, options: null }
          : { themeId: nextThemeId, options: nextOptions },
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-muted/30 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={isInheriting}
            onCheckedChange={(value) =>
              handleToggleInherit(value === true)
            }
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="text-sm font-medium">채널 기본 테마 사용</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              이 위젯에만 다른 테마를 쓰고 싶을 때 체크 해제 후 테마를
              선택하세요.
            </p>
          </div>
        </label>
      </div>

      {isInheriting ? (
        <div className="rounded-xl border border-dashed bg-muted/10 px-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {effectiveTheme?.name
              ? `${effectiveTheme.name} 테마가 적용됩니다.`
              : "채널 기본 테마가 적용됩니다."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {rawDefaultThemeId === effectiveThemeId
              ? '"기본" 탭에서 테마와 옵션을 설정할 수 있습니다.'
              : "이 위젯에만 다른 테마를 쓰고 싶을 때 체크 해제 후 테마를 선택하세요."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">
            {WIDGET_LABELS[widgetType]} 전용 테마
          </h3>
          <ThemeGrid
            selectedThemeId={effectiveThemeId}
            onSelect={handleThemeSelect}
            defaultOpen={false}
          />
        </div>
      )}

      {/* 공통 옵션은 상속/오버라이드와 무관하게 항상 표시 — 테마에 종속되지
          않는 위젯 단위 설정이므로 기본 테마 모드에서도 편집 가능해야 한다. */}
      {widgetType === "queue" && (
        <>
          <Separator />
          <CommonQueueOptions
            values={effectiveOptions}
            onChange={handleOptionChange}
          />
        </>
      )}

      {widgetType === "setlist" && (
        <>
          <Separator />
          <CommonSetlistOptions
            values={effectiveOptions}
            onChange={handleOptionChange}
          />
        </>
      )}

      {/* 테마 옵션 폼은 오버라이드 모드에서만 편집 가능 (테마별 optionSchema). */}
      {!isInheriting && (
        <>
          <Separator />
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">테마 옵션</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                이 위젯에만 적용되는 옵션입니다. 변경 사항은 저장 버튼을 눌러야
                반영됩니다.
              </p>
            </div>
            {effectiveTheme && effectiveTheme.optionSchema.length > 0 ? (
              <DynamicOptionForm
                schema={effectiveTheme.optionSchema}
                values={effectiveOptions}
                onChange={handleOptionChange}
                theme={effectiveTheme}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                이 테마는 추가 옵션이 없습니다.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 큐 위젯의 공통(테마 무관) 옵션 폼.
 * 자동 스크롤은 wrapper 레벨에서 처리되므로 모든 테마에 동일하게 적용된다.
 */
function CommonQueueOptions({
  values,
  onChange,
}: {
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const autoScrollEnabled = readBooleanOption(values.autoScrollEnabled);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">공통 옵션</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          테마와 관계없이 큐 위젯 전체에 적용되는 옵션입니다.
        </p>
      </div>
      <div className="rounded-md border px-4">
        <SettingsRow
          title="자동 스크롤"
          description="곡 목록이 길어 화면을 벗어나면 자동으로 위↔아래 무한 스크롤합니다."
          controlClassName="flex items-start sm:justify-end"
        >
          <Switch
            checked={autoScrollEnabled}
            onCheckedChange={(checked) =>
              onChange("autoScrollEnabled", checked)
            }
          />
        </SettingsRow>
      </div>
    </div>
  );
}

/**
 * 셋리스트 위젯의 공통(테마 무관) 옵션 폼.
 * 테마가 직접 그리지 않는 wrapper-level 옵션을 여기서 토글한다.
 */
function CommonSetlistOptions({
  values,
  onChange,
}: {
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  // catalog defaultOptions.showAlbumArt === true 이므로 저장값이 명시적으로
  // false일 때만 끈다. undefined/null/그 외 값은 기본 ON으로 해석.
  const showAlbumArt = values.showAlbumArt !== false;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">공통 옵션</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          테마와 관계없이 셋리스트 위젯 전체에 적용되는 옵션입니다.
        </p>
      </div>
      <div className="rounded-md border px-4">
        <SettingsRow
          title="앨범아트 표시"
          description="NOW PLAYING 영역에 재생 중인 곡의 앨범아트 썸네일을 표시합니다."
          controlClassName="flex items-start sm:justify-end"
        >
          <Switch
            checked={showAlbumArt}
            onCheckedChange={(checked) =>
              onChange("showAlbumArt", checked)
            }
          />
        </SettingsRow>
      </div>
    </div>
  );
}
