"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  LayoutGrid,
  Loader2,
  Palette,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/meloming/shared/components/ui/button";
import { SegmentedControl } from "@/meloming/shared/components/ui/segmented-control";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import {
  useRegenerateOverlayToken,
  useRefreshOverlay,
} from "@/meloming/domains/channel/hooks/use-overlay-token";
import { useUnifiedThemeConfig } from "@/meloming/domains/channel/hooks/use-overlay-theme";
import { VALID_WIDGET_TYPES } from "@/meloming/domains/channel/apis/overlay-theme";
import {
  useActiveSession,
  useUpdateSessionSettings,
} from "@/meloming/domains/overlay/hooks/use-session";
import { useSetupStatus } from "@/meloming/domains/overlay/hooks/use-onboarding";
import {
  SetupChecklist,
  FeatureFlow,
  OBSSetupGuide,
} from "../onboarding";
import { FloatingSaveBar } from "../theme-management/FloatingSaveBar";
import { cn } from "@/meloming/shared/lib/utils";
import {
  SettingsPanel,
  SettingsRow,
  SettingsSectionHeader,
} from "@/meloming/shared/components/common/settings-form";

interface OverviewTabContentProps {
  user: string;
  tokenData: { overlayToken?: string | null } | undefined;
  isTokenLoading: boolean;
}

const VARIANT_STYLES = {
  default:
    "from-indigo-500 to-indigo-600 dark:from-indigo-500 dark:to-indigo-700 hover:shadow-indigo-500/25",
  alt: "from-indigo-600 to-violet-600 dark:from-indigo-600 dark:to-violet-700 hover:shadow-violet-500/25",
  accent:
    "from-violet-500 to-purple-600 dark:from-violet-500 dark:to-purple-700 hover:shadow-purple-500/25",
} as const;

function QuickActionCard({
  icon: Icon,
  title,
  description,
  onClick,
  isPending,
  variant = "default",
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  isPending?: boolean;
  variant?: keyof typeof VARIANT_STYLES;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className={cn(
        "group relative overflow-hidden rounded-2xl bg-gradient-to-br p-6 text-left text-white transition-all duration-200 hover:-translate-y-1 hover:shadow-xl active:translate-y-0 disabled:opacity-70 disabled:hover:translate-y-0",
        VARIANT_STYLES[variant],
      )}
    >
      <div className="absolute top-0 right-0 -mr-6 -mt-6 size-32 rounded-full bg-white/10 blur-2xl transition-transform duration-500 group-hover:scale-150" />
      <div className="absolute bottom-0 left-0 -ml-4 -mb-4 size-20 rounded-full bg-white/5 blur-xl" />

      <div className="relative">
        <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm ring-1 ring-white/10">
          {isPending ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Icon className="size-5" />
          )}
        </div>
        <div className="text-lg font-bold tracking-tight">{title}</div>
        <div className="mt-1.5 text-sm leading-relaxed text-white/70">
          {description}
        </div>
        <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-white/80 opacity-0 -translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
          <span>바로가기</span>
          <ArrowRight className="size-3.5" />
        </div>
      </div>
    </button>
  );
}

export function OverviewTabContent({
  user,
  tokenData,
  isTokenLoading,
}: OverviewTabContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false);

  const { data: themeConfig, isLoading: themeLoading } = useUnifiedThemeConfig(
    user,
    Boolean(user),
  );
  const hasWidgetConfig = Boolean(
    themeConfig &&
      (themeConfig.default.themeId !== "apple" ||
        VALID_WIDGET_TYPES.some((widget) => {
          const entry = themeConfig.widgets?.[widget];
          return Boolean(
            entry && (entry.themeId !== null || entry.options !== null),
          );
        })),
  );
  const widgetConfigsData = hasWidgetConfig
    ? { widgets: [{}] }
    : { widgets: [] };

  const { data: activeSession, isLoading: sessionLoading } =
    useActiveSession(user);
  const updateSessionSettingsMutation = useUpdateSessionSettings(user);

  const setupStatus = useSetupStatus({
    tokenData,
    widgetConfigsData,
    hasActiveSession: Boolean(activeSession?.id),
    isLoading: isTokenLoading || themeLoading || sessionLoading,
  });

  const regenerateMutation = useRegenerateOverlayToken(user);
  const refreshOverlayMutation = useRefreshOverlay(user);

  const serverShowRequesterName =
    activeSession?.settings?.showRequesterName ?? true;
  const [draftShowRequesterName, setDraftShowRequesterName] = useState<
    boolean | null
  >(null);
  const showRequesterName = draftShowRequesterName ?? serverShowRequesterName;
  const isShowRequesterNameDirty =
    draftShowRequesterName !== null &&
    draftShowRequesterName !== serverShowRequesterName;
  const showRequesterNameDisabled =
    !activeSession?.id ||
    sessionLoading ||
    updateSessionSettingsMutation.isPending;

  const navigateToTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const handleShowRequesterNameChange = (value: "show" | "hide") => {
    if (!activeSession?.id) {
      toast.error("신청곡 모드가 활성화되어 있지 않습니다");
      return;
    }
    setDraftShowRequesterName(value === "show");
  };

  const changedCount = isShowRequesterNameDirty ? 1 : 0;

  const handleSaveOverlayOptions = async () => {
    if (!activeSession?.id || draftShowRequesterName === null) return;
    try {
      await updateSessionSettingsMutation.mutateAsync({
        sessionId: activeSession.id,
        settings: { showRequesterName: draftShowRequesterName },
      });
      toast.success("오버레이 설정이 저장되었습니다");
      setDraftShowRequesterName(null);
    } catch {
      toast.error("저장에 실패했습니다");
    }
  };

  const handleResetOverlayOptions = () => {
    setDraftShowRequesterName(null);
  };

  const handleRegenerateToken = async () => {
    try {
      await regenerateMutation.mutateAsync();
      toast.success("오버레이 주소가 새로 생성되었습니다");
      setIsRegenerateDialogOpen(false);
    } catch {
      toast.error("주소 재생성에 실패했습니다");
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Quick Actions ── */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <div className="size-1.5 rounded-full bg-indigo-500" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            빠른 작업
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <QuickActionCard
            icon={Palette}
            title="테마 선택"
            description="오버레이의 색상과 스타일을 꾸며보세요"
            onClick={() => navigateToTab("default")}
          />
          <QuickActionCard
            icon={LayoutGrid}
            title="레이아웃 편집"
            description="위젯의 위치와 크기를 자유롭게 배치하세요"
            onClick={() => navigateToTab("total")}
            variant="alt"
          />
          <QuickActionCard
            icon={RefreshCw}
            title="오버레이 새로고침"
            description="OBS에 등록된 모든 위젯을 즉시 반영합니다"
            onClick={() => {
              refreshOverlayMutation.mutate(undefined, {
                onSuccess: () =>
                  toast.success("오버레이 새로고침 신호를 보냈습니다"),
                onError: () => toast.error("새로고침에 실패했습니다"),
              });
            }}
            isPending={refreshOverlayMutation.isPending}
            variant="accent"
          />
        </div>
      </section>

      {/* ── Setup Checklist ── */}
      <SetupChecklist status={setupStatus} />

      {/* ── Feature Flow ── */}
      <FeatureFlow />

      <SettingsPanel className="border-indigo-500/20">
        <SettingsSectionHeader title="오버레이 표시 설정" />
        <SettingsRow
          title="신청자 이름 표시"
          description="오버레이에 곡 신청자의 닉네임을 표시합니다"
          controlClassName="flex items-start sm:justify-end"
        >
              <SegmentedControl
                value={showRequesterName ? "show" : "hide"}
                options={[
                  { value: "show", label: "표시" },
                  { value: "hide", label: "숨김" },
                ]}
                disabled={showRequesterNameDisabled}
                onValueChange={handleShowRequesterNameChange}
                aria-label="신청자 이름 표시 여부"
              />
        </SettingsRow>
          {!activeSession?.id && (
            <p className="py-3 text-xs text-muted-foreground">
              신청곡 모드 시작 후에 변경할 수 있습니다
            </p>
          )}
      </SettingsPanel>

      {/* ── OBS Setup Guide ── */}
      <OBSSetupGuide width={1920} height={1080} widgetName="오버레이" />

      {/* ── OBS Compatibility Warning ── */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          오버레이의 배경 투명 처리는{" "}
          <span className="font-medium text-amber-600 dark:text-amber-400">
            OBS 31.0.0 이상
          </span>
          에서만 정상 작동합니다. 이전 버전에서는 배경이 까맣게 표시될 수
          있습니다.
        </p>
      </div>

      <SettingsPanel>
        <SettingsSectionHeader title="고급 설정" />
        <SettingsRow
          title="오버레이 주소 재생성"
          description="기존 OBS에 등록한 URL이 모두 무효화됩니다"
          controlClassName="flex items-start sm:justify-end"
        >
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsRegenerateDialogOpen(true)}
                disabled={regenerateMutation.isPending}
                className="shrink-0"
              >
                {regenerateMutation.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                새 주소 생성
              </Button>
        </SettingsRow>
      </SettingsPanel>

      <AlertDialog
        open={isRegenerateDialogOpen}
        onOpenChange={setIsRegenerateDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 paperlogy">
              <AlertTriangle className="size-5 text-amber-500" />
              주소를 재생성할까요?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>모든 오버레이 주소가 새로 생성됩니다.</p>
              <p className="text-destructive">
                기존 주소는 더 이상 작동하지 않으며, OBS 브라우저 소스의 URL을
                모두 새로 설정해야 합니다.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRegenerateToken}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              새 주소 생성
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {changedCount > 0 && (
        <FloatingSaveBar
          changedCount={changedCount}
          onSave={handleSaveOverlayOptions}
          onReset={handleResetOverlayOptions}
          isPending={updateSessionSettingsMutation.isPending}
        />
      )}
    </div>
  );
}
