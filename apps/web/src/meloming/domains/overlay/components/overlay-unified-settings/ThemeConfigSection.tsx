"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import { isEqual } from "es-toolkit";
import { toast } from "sonner";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import {
  toUpdateBody,
  type UnifiedThemeConfig,
  type WidgetType,
} from "@/meloming/domains/channel/apis/overlay-theme";
import {
  useThemeCatalog,
  useUnifiedThemeConfig,
  useUpdateUnifiedThemeConfig,
} from "@/meloming/domains/channel/hooks/use-overlay-theme";
import { FloatingSaveBar } from "../theme-management/FloatingSaveBar";
import { ThemeTabContent } from "../theme-management/ThemeTabContent";
import { WidgetTabContent } from "../theme-management/WidgetTabContent";
import { ThemePreview } from "../theme-management/ThemePreview";
import { countChanges } from "../theme-management/utils";
import { overlayThemeDirtyGuard } from "./dirty-guard";

export type ThemeTabActive = "default" | WidgetType;

export interface ThemeConfigSectionHandle {
  /** 현재 draft가 서버 config과 다르면 true. 부모는 outer 탭 이동 전에 체크. */
  isDirty: () => boolean;
}

interface ThemeConfigSectionProps {
  channelIdentifier: string;
  overlayToken: string | null;
  /** 부모가 주입하는 현재 활성 theme 탭. */
  activeTab: ThemeTabActive;
}

/**
 * Theme 계열 탭(default + 4 widgets)의 공용 컨테이너.
 *
 * - draft state + isDirty 계산 + beforeunload 가드 + save/reset 핸들러를 내부에 둔다.
 * - activeTab에 따라 ThemeTabContent 또는 WidgetTabContent를 렌더.
 * - dirty 상태는 forwardRef + useImperativeHandle로 부모에 노출 → 부모가 outer 탭 이동 시 confirm.
 */
export const ThemeConfigSection = forwardRef<
  ThemeConfigSectionHandle,
  ThemeConfigSectionProps
>(function ThemeConfigSection(
  { channelIdentifier, overlayToken, activeTab },
  ref,
) {
  const {
    data: config,
    isLoading: configLoading,
    isError: configError,
    error: configErrorValue,
  } = useUnifiedThemeConfig(channelIdentifier);
  const { data: catalogData, isLoading: catalogLoading } = useThemeCatalog();
  const mutation = useUpdateUnifiedThemeConfig(channelIdentifier);

  const [draft, setDraft] = useState<UnifiedThemeConfig | null>(null);
  const draftInitializedRef = useRef(false);

  const isDirty = useMemo(() => {
    if (!draft || !config) return false;
    return !isEqual(draft, config);
  }, [draft, config]);

  // 부모가 ref.current.isDirty() 호출하여 확인 가능
  useImperativeHandle(ref, () => ({ isDirty: () => isDirty }), [isDirty]);

  // 서버 config 수신 시 draft 초기화/보존 정책 (기존 UnifiedThemeManagement와 동일)
  useEffect(() => {
    if (!config) return;
    if (!draftInitializedRef.current) {
      setDraft(structuredClone(config));
      draftInitializedRef.current = true;
    } else if (isDirty) {
      toast.info("다른 곳에서 설정이 변경되었습니다. 저장 전 확인하세요.");
    } else {
      setDraft(structuredClone(config));
    }
    // isDirty는 파생값이므로 deps에 넣으면 무한 루프
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const changedCount = useMemo(
    () => countChanges(config ?? null, draft),
    [config, draft],
  );

  // dirty일 때 브라우저 이탈 경고
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // 모듈 레벨 dirty 플래그 갱신 → 사이드바가 SPA 네비게이션 전에 confirm 가능
  useEffect(() => {
    overlayThemeDirtyGuard.set(isDirty);
    return () => overlayThemeDirtyGuard.set(false);
  }, [isDirty]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    try {
      await mutation.mutateAsync(toUpdateBody(draft));
      toast.success("테마 설정이 저장되었습니다");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "테마 저장에 실패했습니다";
      toast.error(message);
    }
  }, [draft, mutation]);

  const handleReset = useCallback(() => {
    if (!config) return;
    setDraft(structuredClone(config));
    toast.info("변경사항을 되돌렸습니다.");
  }, [config]);

  const handleDraftChange = useCallback((next: UnifiedThemeConfig) => {
    setDraft(next);
  }, []);

  const isLoading = configLoading || catalogLoading;

  if (isLoading || !draft) {
    return (
      <Card className="py-0">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (configError) {
    const message =
      configErrorValue instanceof Error
        ? configErrorValue.message
        : "테마 설정을 불러오지 못했습니다.";
    return (
      <Card className="py-0">
        <CardContent className="space-y-1 py-6">
          <p className="text-sm font-medium text-destructive">
            테마 설정을 불러오지 못했습니다.
          </p>
          <p className="text-xs text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    );
  }

  const catalog = catalogData?.themes ?? [];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="py-0">
          <CardContent className="py-5 px-5">
            {activeTab === "default" ? (
              <ThemeTabContent
                draft={draft}
                onChange={handleDraftChange}
                catalog={catalog}
              />
            ) : (
              <WidgetTabContent
                widgetType={activeTab}
                draft={draft}
                onChange={handleDraftChange}
                catalog={catalog}
              />
            )}
          </CardContent>
        </Card>

        <Card className="py-0 lg:sticky lg:top-[calc(var(--page-content-sticky-top)+1rem)] lg:self-start">
          <CardContent className="py-5 px-5">
            <ThemePreview
              overlayToken={overlayToken}
              activeTab={activeTab}
              draft={draft}
            />
          </CardContent>
        </Card>
      </div>

      {(isDirty || mutation.isPending) && (
        <FloatingSaveBar
          changedCount={Math.max(changedCount, 1)}
          onSave={handleSave}
          onReset={handleReset}
          isPending={mutation.isPending}
        />
      )}
    </>
  );
});
