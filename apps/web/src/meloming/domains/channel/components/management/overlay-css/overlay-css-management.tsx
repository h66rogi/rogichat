"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Code2,
  Save,
  Loader2,
  RotateCcw,
  Trash2,
  Undo2,
  Redo2,
  Crosshair,
  Copy,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Switch } from "@/meloming/shared/components/ui/switch";
import { Label } from "@/meloming/shared/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/meloming/shared/components/ui/resizable";
import { PillTabs, type PillTabItem } from "@/meloming/shared/components/ui/pill-tabs";
import { ManagementHeader } from "../management-header";
import { CssEditor } from "../decoration/css-editor";
import { useCssHistory } from "@/meloming/domains/channel/hooks/use-css-history";
import {
  useOverlayCustomizationList,
  useOverlayCustomizationMutations,
} from "@/meloming/domains/channel/hooks/use-overlay-customization";
import { useRefreshOverlay } from "@/meloming/domains/channel/hooks/use-overlay-token";
import { useChannelPermission } from "@/meloming/domains/channel/hooks/use-channel";
import { isAxiosError } from "@/meloming/shared/lib/axios-error";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import {
  OVERLAY_WIDGET_LABELS,
  OVERLAY_WIDGET_TYPES,
  type OverlayWidgetType,
} from "@/meloming/domains/channel/types/overlay-customization";
import { OverlayCssCheatsheetPanel } from "./overlay-css-cheatsheet-panel";
import { OverlayCssPreview } from "./overlay-css-preview";

interface OverlayCssManagementProps {
  identifier: string;
  overlayToken: string;
}

const WIDGET_TIPS: Record<OverlayWidgetType, string> = {
  queue: "OBS 신청곡 리스트 위젯. 배경색, 폰트, 카드 모서리까지 자유롭게 꾸며보세요.",
  "now-playing": "현재 부르는 곡을 강조하는 위젯. 그림자, 애니메이션으로 시선을 끌 수 있습니다.",
  setlist: "셋리스트 위젯. 배경 투명도, 간격, 구분선 등을 다듬어보세요.",
  "songbook-qr": "노래책 QR 위젯. 카드 배경, QR 테두리, 라벨 스타일을 방송 화면에 맞게 조정하세요.",
};

/**
 * 오버레이 위젯 커스텀 CSS 관리 컴포넌트
 * - 위젯별 탭
 * - CodeMirror 기반 CSS 에디터 + Undo/Redo + 미리보기 + 요소 선택기
 * - 저장 권한: 채널 소유자 또는 커스텀 CSS 관리 권한이 있는 매니저
 */
export function OverlayCssManagement({
  identifier,
  overlayToken,
}: OverlayCssManagementProps) {
  const { data: permission } = useChannelPermission(identifier);
  const { data, isLoading, error } = useOverlayCustomizationList(identifier);
  const { saveCss, toggleEnabled, deleteCss } =
    useOverlayCustomizationMutations(identifier);
  const refreshOverlay = useRefreshOverlay(identifier);

  const isOwner = permission?.isOwner ?? false;
  // 서버가 내려주는 canSave를 신뢰 — 소유자/매니저 권한 종합 판단
  const canSave = data?.canSave ?? false;

  const [active, setActive] = useState<OverlayWidgetType>("queue");
  const [draft, setDraft] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [inspectorActive, setInspectorActive] = useState(false);
  const [pickedSelector, setPickedSelector] = useState<string | null>(null);
  // 저장 직후 OBS 오버레이 새로고침 유도 배너 노출 여부
  const [showRefreshHint, setShowRefreshHint] = useState(false);
  const history = useCssHistory({ maxHistory: 30 });

  const current = useMemo(
    () => data?.items.find((item) => item.widgetType === active) ?? null,
    [data, active]
  );

  // 위젯 전환 시 서버 데이터로 드래프트 초기화
  useEffect(() => {
    const initialCss = current?.customCss ?? "";
    setDraft(initialCss);
    setEnabled(current?.isEnabled ?? false);
    setHasUnsavedChanges(false);
    history.initHistory(initialCss);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, active]);

  // 위젯 탭 전환 시 인스펙터 상태 리셋
  useEffect(() => {
    setInspectorActive(false);
    setPickedSelector(null);
  }, [active]);

  const widgetTabs: PillTabItem<OverlayWidgetType>[] = OVERLAY_WIDGET_TYPES.map(
    (widget) => ({
      id: widget,
      label: OVERLAY_WIDGET_LABELS[widget],
    })
  );

  const handleDraftChange = useCallback(
    (value: string) => {
      setDraft(value);
      const baseline = current?.customCss ?? "";
      setHasUnsavedChanges(
        value !== baseline || enabled !== (current?.isEnabled ?? false)
      );
    },
    [current, enabled]
  );

  const handleInspectorResult = useCallback(
    (result: { selector: string } | null) => {
      setInspectorActive(false);
      if (result) setPickedSelector(result.selector);
    },
    []
  );

  const handleInsertSelector = () => {
    if (!pickedSelector) return;
    const snippet = `\n${pickedSelector} {\n  \n}\n`;
    handleDraftChange(draft + snippet);
    toast.success("셀렉터를 에디터에 추가했습니다.");
  };

  const handleCopySelector = async () => {
    if (!pickedSelector) return;
    try {
      await navigator.clipboard.writeText(pickedSelector);
      toast.success("셀렉터를 복사했습니다.");
    } catch {
      toast.error("복사에 실패했습니다.");
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    history.pushHistory(draft, `편집: ${active}`);
    try {
      await saveCss.mutateAsync({
        widget: active,
        body: { customCss: draft, isEnabled: enabled },
      });
      setHasUnsavedChanges(false);
      setShowRefreshHint(true);
      toast.success("저장되었습니다.");
    } catch (err: unknown) {
      if (isAxiosError(err)) {
        const errors = (
          err.response?.data as { errors?: Array<{ message?: string }> }
        )?.errors;
        if (Array.isArray(errors) && errors.length > 0) {
          toast.error(`검증 실패: ${errors[0]?.message ?? "검증 실패"}`);
          return;
        }
      }
      toast.error("저장에 실패했습니다.");
    }
  };

  const handleToggleEnabled = async (next: boolean) => {
    setEnabled(next);
    if (!current?.id) {
      setHasUnsavedChanges(true);
      return;
    }
    try {
      await toggleEnabled.mutateAsync({ widget: active, isEnabled: next });
      setShowRefreshHint(true);
      toast.success(next ? "활성화되었습니다." : "비활성화되었습니다.");
    } catch {
      setEnabled(!next);
      toast.error("설정 변경에 실패했습니다.");
    }
  };

  const handleReset = () => {
    setDraft(current?.customCss ?? "");
    setEnabled(current?.isEnabled ?? false);
    setHasUnsavedChanges(false);
    toast.info("변경사항이 초기화되었습니다.");
  };

  const handleDelete = async () => {
    if (!window.confirm("저장된 CSS를 완전히 삭제할까요?")) return;
    try {
      await deleteCss.mutateAsync(active);
      setDraft("");
      setEnabled(false);
      setHasUnsavedChanges(false);
      setShowRefreshHint(true);
      toast.success("삭제되었습니다.");
    } catch {
      toast.error("삭제에 실패했습니다.");
    }
  };

  const handleRefreshOverlay = () => {
    refreshOverlay.mutate(undefined, {
      onSuccess: () => {
        toast.success("OBS 오버레이에 새로고침 신호를 보냈어요.");
        setShowRefreshHint(false);
      },
      onError: () => toast.error("오버레이 새로고침에 실패했습니다."),
    });
  };

  const handleUndo = () => {
    const entry = history.undo();
    if (entry) {
      setDraft(entry.css);
      setHasUnsavedChanges(entry.css !== (current?.customCss ?? ""));
    }
  };

  const handleRedo = () => {
    const entry = history.redo();
    if (entry) {
      setDraft(entry.css);
      setHasUnsavedChanges(entry.css !== (current?.customCss ?? ""));
    }
  };

  // 로딩
  if (isLoading) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="오버레이 위젯 커스텀 CSS"
          description="신청곡 · 지금 부르는 곡 · 곡 목록 · 노래책 QR 오버레이를 CSS로 꾸밀 수 있습니다."
          icon={Code2}
        />
        <div className="text-sm text-muted-foreground mt-6">불러오는 중...</div>
      </div>
    );
  }

  // 에러
  if (error) {
    const errMsg = extractApiErrorMessage(
      error,
      "오버레이 설정을 불러오지 못했습니다."
    );
    return (
      <div className="p-6">
        <ManagementHeader
          title="오버레이 위젯 커스텀 CSS"
          description="신청곡 · 지금 부르는 곡 · 곡 목록 · 노래책 QR 오버레이를 CSS로 꾸밀 수 있습니다."
          icon={Code2}
        />
        <div className="mt-6 space-y-2">
          <p className="text-destructive font-medium">
            커스텀 CSS 데이터를 불러오지 못했습니다.
          </p>
          <p className="text-sm text-muted-foreground">{errMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-[calc(100vh-64px)] flex flex-col">
      <ManagementHeader
        title="오버레이 위젯 커스텀 CSS"
        description="방송 오버레이 위젯을 내 채널 스타일로 꾸며보세요. 실시간 미리보기로 바로 확인할 수 있습니다."
        icon={Code2}
      >
        <div className="flex items-center gap-4">
          {hasUnsavedChanges && (
            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
              저장되지 않음
            </span>
          )}

          <div className="flex items-center gap-2 pl-3 border-l">
            <Switch
              id="overlay-css-enabled"
              checked={enabled}
              onCheckedChange={handleToggleEnabled}
              disabled={isLoading || toggleEnabled.isPending || !canSave}
            />
            <Label
              htmlFor="overlay-css-enabled"
              className="text-sm text-muted-foreground"
            >
              {enabled ? "적용 중" : "미적용"}
            </Label>
          </div>

          <Button
            onClick={handleSave}
            disabled={
              !canSave ||
              !hasUnsavedChanges ||
              saveCss.isPending ||
              isLoading
            }
            size="sm"
            className="gap-2"
          >
            {saveCss.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            저장
          </Button>
        </div>
      </ManagementHeader>

      {showRefreshHint && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-4 py-2.5">
          <RefreshCw className="size-4 shrink-0 text-indigo-500" />
          <div className="flex-1 min-w-0 text-sm">
            <span className="font-medium text-indigo-700 dark:text-indigo-300">
              저장 완료.
            </span>{" "}
            <span className="text-muted-foreground">
              OBS에 이미 띄워둔 오버레이에는 바뀐 CSS가 자동으로 반영되지
              않아요. 지금 새로고침 신호를 보내 적용할까요?
            </span>
          </div>
          <Button
            size="sm"
            onClick={handleRefreshOverlay}
            disabled={refreshOverlay.isPending}
            className="gap-1.5 shrink-0"
          >
            {refreshOverlay.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            지금 새로고침
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => setShowRefreshHint(false)}
            aria-label="안내 닫기"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <PillTabs
          tabs={widgetTabs}
          activeTab={active}
          onTabChange={setActive}
        />
        <p className="text-xs text-muted-foreground">{WIDGET_TIPS[active]}</p>
      </div>

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full rounded-lg border"
        >
          <ResizablePanel defaultSize={42} minSize={30}>
            <div className="h-full flex flex-col">
              <div className="border-b px-2 py-1.5 flex items-center gap-1 bg-muted/30">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUndo}
                  disabled={!history.canUndo}
                  className="h-8 gap-1"
                >
                  <Undo2 className="size-4" />
                  <span className="hidden sm:inline">되돌리기</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRedo}
                  disabled={!history.canRedo}
                  className="h-8 gap-1"
                >
                  <Redo2 className="size-4" />
                  <span className="hidden sm:inline">다시 실행</span>
                </Button>
                <div className="w-px h-5 bg-border mx-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  disabled={!hasUnsavedChanges}
                  className="h-8 gap-1"
                >
                  <RotateCcw className="size-4" />
                  <span className="hidden sm:inline">초기화</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={!canSave || !current?.id || deleteCss.isPending}
                  className="h-8 gap-1 text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  <span className="hidden sm:inline">삭제</span>
                </Button>
              </div>
              <div className="flex-1 min-h-0 p-2">
                <CssEditor
                  value={draft}
                  onChange={handleDraftChange}
                  disabled={!isOwner && !canSave}
                  height="100%"
                  className="h-full"
                />
              </div>
              <div className="border-t p-3 max-h-[240px] overflow-y-auto">
                <OverlayCssCheatsheetPanel widget={active} />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={58} minSize={40}>
            <div className="h-full flex flex-col">
              <div className="border-b px-2 py-1.5 flex items-center gap-2 bg-muted/30 flex-wrap">
                <Button
                  type="button"
                  size="sm"
                  variant={inspectorActive ? "default" : "ghost"}
                  className="h-8 gap-1"
                  onClick={() => setInspectorActive((v) => !v)}
                >
                  <Crosshair className="size-4" />
                  {inspectorActive ? "요소 선택 중… (ESC 취소)" : "요소 선택"}
                </Button>
                {pickedSelector && (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <code className="text-xs bg-background border px-2 py-1 rounded truncate flex-1">
                      {pickedSelector}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1"
                      onClick={handleCopySelector}
                    >
                      <Copy className="size-4" />
                      <span className="hidden md:inline">복사</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1"
                      onClick={handleInsertSelector}
                    >
                      <Plus className="size-4" />
                      <span className="hidden md:inline">에디터에 삽입</span>
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <OverlayCssPreview
                  overlayToken={overlayToken}
                  widget={active}
                  draftCss={draft}
                  inspectorActive={inspectorActive}
                  onInspectorResult={handleInspectorResult}
                  className="size-full"
                />
              </div>
              <p className="text-xs text-muted-foreground px-3 py-2 border-t bg-muted/20">
                타이핑 즉시 미리보기에 반영됩니다. 저장해야 실제 오버레이에 적용됩니다.
              </p>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
