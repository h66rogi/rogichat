"use client";

import { useMemo } from "react";
import { Separator } from "@/meloming/shared/components/ui/separator";
import { ThemeGrid } from "@/meloming/domains/overlay/components/theme-selection";
import { DynamicOptionForm } from "@/meloming/domains/overlay/components/theme-settings/dynamic-form/DynamicOptionForm";
import type {
  ThemeCatalogEntry,
  UnifiedThemeConfig,
} from "@/meloming/domains/channel/apis/overlay-theme";

interface ThemeTabContentProps {
  /** 로컬 편집 중인 통합 설정 */
  draft: UnifiedThemeConfig;
  /** 설정 변경 핸들러 */
  onChange: (next: UnifiedThemeConfig) => void;
  /** 테마 카탈로그 */
  catalog: ThemeCatalogEntry[];
}

/**
 * "기본" 탭 콘텐츠.
 *
 * - 상단: 14개 카탈로그 테마 중 하나를 선택할 수 있는 그리드
 * - 하단: 선택된 테마의 `optionSchema`에 기반한 동적 옵션 폼
 *
 * 이 탭의 변경 사항은 `draft.default`에 저장되며, 위젯 override가 없는
 * 모든 위젯에 그대로 상속된다.
 */
export function ThemeTabContent({
  draft,
  onChange,
  catalog,
}: ThemeTabContentProps) {
  const selectedTheme = useMemo<ThemeCatalogEntry | undefined>(
    () => catalog.find((theme) => theme.id === draft.default.themeId),
    [catalog, draft.default.themeId],
  );

  const handleThemeSelect = (themeId: string) => {
    if (themeId === draft.default.themeId) return;
    const nextTheme = catalog.find((theme) => theme.id === themeId);
    // 새 테마 선택 시 해당 테마의 defaultOptions로 초기화한다.
    // (이전 테마에서 쓰던 옵션 키가 새 테마에는 존재하지 않을 수 있음)
    const defaultOptions = nextTheme?.defaultOptions ?? {};
    onChange({
      ...draft,
      default: {
        themeId,
        options: { ...defaultOptions },
      },
    });
  };

  const handleOptionChange = (key: string, value: unknown) => {
    // 빈 문자열은 "이 키를 unset" 의미로 해석해 options에서 삭제한다. backend
    // sanitizeCommonOptions가 빈/invalid hex를 strip해 응답에서 키가 사라지면,
    // 프론트가 ""를 들고 있으면 isEqual 비교가 영구히 false라 save bar가 stuck.
    const nextOptions: Record<string, unknown> = { ...draft.default.options };
    if (value === '' || value === undefined) {
      delete nextOptions[key];
    } else {
      nextOptions[key] = value;
    }
    onChange({
      ...draft,
      default: {
        ...draft.default,
        options: nextOptions,
      },
    });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        모든 위젯에 기본 적용되는 테마입니다. 위젯별로 다른 테마를 고르려면
        해당 탭에서 설정하세요.
      </p>

      <ThemeGrid
        selectedThemeId={draft.default.themeId}
        onSelect={handleThemeSelect}
      />

      <Separator />

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">테마 옵션</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            선택한 테마의 세부 옵션을 조정하세요. 변경 사항은 저장 버튼을
            눌러야 반영됩니다.
          </p>
        </div>
        {selectedTheme && selectedTheme.optionSchema.length > 0 ? (
          <DynamicOptionForm
            schema={selectedTheme.optionSchema}
            values={draft.default.options}
            onChange={handleOptionChange}
            theme={selectedTheme}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            이 테마는 추가 옵션이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
