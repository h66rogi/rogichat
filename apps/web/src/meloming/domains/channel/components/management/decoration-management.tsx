"use client";

import { useState, useLayoutEffect, useCallback, useRef, useEffect } from "react";
import { useParams } from "next/dist/client/components/navigation";
import { Paintbrush, Save, AlertCircle, Lock, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AxiosError } from "axios";
import { ManagementHeader } from "./management-header";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Switch } from "@/meloming/shared/components/ui/switch";
import { Label } from "@/meloming/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/meloming/shared/components/ui/alert";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/meloming/shared/components/ui/resizable";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { useChannel, useChannelPermission, channelKeys } from "@/meloming/domains/channel/hooks/use-channel";
import { useCssHistory } from "@/meloming/domains/channel/hooks/use-css-history";
import { useCssAi } from "@/meloming/domains/channel/hooks/use-css-ai";
import {
  useChannelCustomization,
  useCustomizationMutations,
  customizationKeys,
} from "@/meloming/domains/channel/hooks/use-customization";
import { CssEditor } from "./decoration/css-editor";
import { CssPreview } from "./decoration/css-preview";
import { AiMainPanel } from "./decoration/ai-main-panel";
import { DecorationToolbar } from "./decoration/decoration-toolbar";
import { PillTabs, type PillTabItem } from "@/meloming/shared/components/ui/pill-tabs";
import { isCssSizeExceeded } from "./decoration/css-utils";
import { BannerUploadField } from "./banner-upload-field";
import { putChannelIdentifier } from "@/meloming/domains/channel/apis/channels";
import {
  VisualOptionSelector,
  LayoutDefaultPreview,
  LayoutWidePreview,
  HeaderWidePreview,
  HeaderSeparatedPreview,
  ColorModeSystemPreview,
  ColorModeLightPreview,
  ColorModeDarkPreview,
  LayoutNewPreview,
} from "./decoration/visual-option-selector";
import {
  Sparkles,
  Settings,
  Code2,
  Undo2,
  Redo2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  CHANNEL_COLOR_MODE_OPTIONS,
  CHANNEL_LAYOUT_WIDTH_OPTIONS,
  CHANNEL_HEADER_STYLE_OPTIONS,
  DEFAULT_CHANNEL_COLOR_MODE,
  DEFAULT_CHANNEL_LAYOUT_WIDTH,
  DEFAULT_CHANNEL_HEADER_STYLE,
  DEFAULT_CHANNEL_LAYOUT_TYPE,
  normalizeChannelColorMode,
  type CssTemplate,
  type CssValidationErrorResponse,
  type ChannelCustomizationData,
  type ChannelCustomizationColorMode,
  type ChannelLayoutWidth,
  type ChannelHeaderStyle,
  type ChannelLayoutType,
} from "@/meloming/domains/channel/types/customization";
import Link from "next/link";
import { AnimatedGradientButton } from "@/meloming/shared/components/ui/animated-gradient-button";
import { ProAnnualPromotionBanner } from "@/meloming/components/pro-annual/pro-annual-promotion-banner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import {
  SettingsPanel,
  SettingsRow,
  SettingsSectionHeader,
} from "@/meloming/shared/components/common/settings-form";

const COLOR_MODE_LABELS: Record<ChannelCustomizationColorMode, string> = {
  system: "기기 설정에 따름",
  light: "라이트 모드",
  dark: "다크 모드",
};

const LAYOUT_WIDTH_LABELS: Record<ChannelLayoutWidth, string> = {
  default: "기본",
  wide: "와이드",
};

const HEADER_STYLE_LABELS: Record<ChannelHeaderStyle, string> = {
  wide: "와이드형",
  separated: "분리형",
};

/**
 * 채널 꾸미기 (커스텀 CSS) 관리 페이지
 */
export function DecorationManagement() {
  const params = useParams();
  const identifier = (params?.user as string) || "";

  // 권한 체크
  const queryClient = useQueryClient();
  const { isProSubscriber: isCurrentUserPro } = useAuth();
  const { data: channel, isLoading: isChannelLoading } = useChannel(identifier);
  const { data: permission, isLoading: isPermissionLoading } = useChannelPermission(identifier);

  // 채널 소유자의 Pro 구독 여부
  const isOwnerProSubscriber = permission?.isOwner
    ? isCurrentUserPro
    : permission?.isOwnerProSubscriber ?? false;
  const hasCustomizationPermission = permission?.isOwner || permission?.manageCustomization;

  // 접근 가능 조건:
  // 1. 소유자: Pro 여부와 관계없이 진입 가능 (Preview 모드)
  // 2. 매니저: 소유자가 Pro일 때만 진입 가능
  const canAccessCustomization = permission?.isOwner || (isOwnerProSubscriber && hasCustomizationPermission);

  // 저장 가능 조건: 소유자가 Pro여야 함
  const canSave = isOwnerProSubscriber && hasCustomizationPermission;

  // Preview 모드: 소유자이지만 Pro가 아닌 경우
  const isPreviewMode = permission?.isOwner && !isCurrentUserPro;

  // 서버 데이터
  const {
    data: customizationResponse,
    isLoading: isCustomizationLoading,
    error: customizationError,
  } = useChannelCustomization(identifier, { enabled: canAccessCustomization });
  const { saveCss, deleteCss } = useCustomizationMutations(identifier);

  // 커스터마이징 데이터 추출
  const customization: ChannelCustomizationData | null = customizationResponse?.customization ?? null;

  const lastSyncedRef = useRef<{ id?: number; updatedAt?: string } | null>(null);

  // 로컬 상태
  const [cssCode, setCssCode] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [forcedColorMode, setForcedColorMode] =
    useState<ChannelCustomizationColorMode>(DEFAULT_CHANNEL_COLOR_MODE);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>();
  const [validationErrors, setValidationErrors] = useState<
    Array<{ message: string; line?: number; column?: number }>
  >([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [editorMode, setEditorMode] = useState<"ai" | "code">("ai");
  const [hasAiGeneratedCss, setHasAiGeneratedCss] = useState(false);
  const [mainTab, setMainTab] = useState<
    "ai-decoration" | "basic-settings" | "custom-css"
  >("basic-settings");
  const [inspectorActive, setInspectorActive] = useState(false);
  const [pickedSelector, setPickedSelector] = useState<string | null>(null);

  const [layoutWidth, setLayoutWidth] = useState<ChannelLayoutWidth>(DEFAULT_CHANNEL_LAYOUT_WIDTH);
  const [headerStyle, setHeaderStyle] = useState<ChannelHeaderStyle>(DEFAULT_CHANNEL_HEADER_STYLE);
  const [layoutType, setLayoutType] = useState<ChannelLayoutType>(DEFAULT_CHANNEL_LAYOUT_TYPE);
  const [leftBannerLink, setLeftBannerLink] = useState<string>("");
  const [rightBannerLink, setRightBannerLink] = useState<string>("");
  const [bannerLinksInitialized, setBannerLinksInitialized] = useState(false);

  // 채널 데이터로 배너 링크 초기화
  useEffect(() => {
    if (channel && !bannerLinksInitialized) {
      setLeftBannerLink(channel.leftBannerLink ?? "");
      setRightBannerLink(channel.rightBannerLink ?? "");
      setBannerLinksInitialized(true);
    }
  }, [channel, bannerLinksInitialized]);

  const savedColorMode = normalizeChannelColorMode(customization?.forcedColorMode);
  const hasColorModeChanges = forcedColorMode !== savedColorMode;
  const savedLayoutWidth = customization?.layoutWidth ?? DEFAULT_CHANNEL_LAYOUT_WIDTH;
  const hasLayoutWidthChanges = layoutWidth !== savedLayoutWidth;
  const savedHeaderStyle = customization?.headerStyle ?? DEFAULT_CHANNEL_HEADER_STYLE;
  const hasHeaderStyleChanges = headerStyle !== savedHeaderStyle;
  const savedLayoutType = customization?.layoutType ?? DEFAULT_CHANNEL_LAYOUT_TYPE;
  const hasLayoutTypeChanges = layoutType !== savedLayoutType;
  const hasLeftBannerLinkChanges = (leftBannerLink || null) !== (channel?.leftBannerLink ?? null);
  const hasRightBannerLinkChanges = (rightBannerLink || null) !== (channel?.rightBannerLink ?? null);
  const hasBannerLinkChanges = hasLeftBannerLinkChanges || hasRightBannerLinkChanges;

  // 메인 탭 정의
  const mainTabItems: PillTabItem<
    "ai-decoration" | "basic-settings" | "custom-css"
  >[] = [
    { id: "basic-settings", label: "기본 설정", icon: Settings },
    { id: "ai-decoration", label: "AI 꾸미기", icon: Sparkles },
    { id: "custom-css", label: "커스텀 CSS", icon: Code2 },
  ];

  const hasBasicSettingsChanges = hasColorModeChanges || hasLayoutWidthChanges || hasHeaderStyleChanges || hasLayoutTypeChanges || hasBannerLinkChanges;

  const handleSaveBasicSettings = async () => {
    try {
      // 커스터마이제이션 설정 저장 (레이아웃, 헤더, 색상)
      const hasCustomizationChanges = hasColorModeChanges || hasLayoutWidthChanges || hasHeaderStyleChanges || hasLayoutTypeChanges;
      if (hasCustomizationChanges) {
        const payload: Record<string, unknown> = {};
        if (hasColorModeChanges) payload.forcedColorMode = forcedColorMode;
        if (hasLayoutWidthChanges) payload.layoutWidth = layoutWidth;
        if (hasHeaderStyleChanges) payload.headerStyle = headerStyle;
        if (hasLayoutTypeChanges) payload.layoutType = layoutType;
        await saveCss.mutateAsync(payload as any);
        // refetch가 완료될 때까지 대기하여 UI가 즉시 반영되도록
        await queryClient.refetchQueries({ queryKey: customizationKeys.css(identifier) });
      }

      // 배너 링크 저장 (채널 API)
      if (hasBannerLinkChanges && channel) {
        await putChannelIdentifier(identifier, {
          name: channel.name,
          webPath: channel.webPath,
          platformUrl: channel.platformUrl ?? "",
          profileImageUrl: channel.profileImageUrl,
          topBannerUrl: channel.topBannerUrl,
          leftBannerUrl: channel.leftBannerUrl,
          leftBannerLink: leftBannerLink.trim() || null,
          rightBannerUrl: channel.rightBannerUrl,
          rightBannerLink: rightBannerLink.trim() || null,
          additionalLinks: channel.additionalLinks,
          themeColor: channel.themeColor,
          channelDescription: channel.channelDescription,
        } as any);
        await queryClient.refetchQueries({ queryKey: channelKeys.identifier(identifier) });
        // 배너 링크 로컬 state도 저장된 값으로 동기화
        setBannerLinksInitialized(false);
      }

      toast.success("설정이 저장되었습니다.");
    } catch {
      toast.error("저장에 실패했습니다.");
    }
  };

  // 배너 업데이트 핸들러 (채널 API 사용)
  const handleBannerChange = async (
    field: "topBannerUrl" | "leftBannerUrl" | "rightBannerUrl",
    value: string | null,
  ) => {
    if (!channel) return;
    try {
      await putChannelIdentifier(identifier, {
        name: channel.name,
        webPath: channel.webPath,
        platformUrl: channel.platformUrl ?? "",
        profileImageUrl: channel.profileImageUrl,
        topBannerUrl: field === "topBannerUrl" ? value : channel.topBannerUrl,
        leftBannerUrl: field === "leftBannerUrl" ? value : channel.leftBannerUrl,
        leftBannerLink: channel.leftBannerLink,
        rightBannerUrl: field === "rightBannerUrl" ? value : channel.rightBannerUrl,
        rightBannerLink: channel.rightBannerLink,
        additionalLinks: channel.additionalLinks,
        themeColor: channel.themeColor,
        channelDescription: channel.channelDescription,
      } as any);
      queryClient.invalidateQueries({ queryKey: channelKeys.identifier(identifier) });
      toast.success("배너 이미지가 변경되었습니다.");
    } catch {
      toast.error("배너 이미지 변경에 실패했습니다.");
    }
  };

  // CSS 히스토리
  const {
    history: cssHistory,
    currentIndex: cssHistoryIndex,
    canUndo,
    canRedo,
    pushHistory,
    initHistory,
    undo,
    redo,
    goToIndex,
  } = useCssHistory({ maxHistory: 30 });

  // 구독 유도 모달 상태
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

  // CSS AI 훅
  const cssAi = useCssAi({
    channelId: channel?.id,
    isOwnerPro: isOwnerProSubscriber,
    onCssGenerated: useCallback(
      (css: string, isPatch: boolean, patchInfo?: { applied: number; failed: string[] }) => {
        setCssCode(css);
        setHasUnsavedChanges(true);
        setHasAiGeneratedCss(true);

        if (isPatch && patchInfo) {
          pushHistory(css, `AI 수정 (${patchInfo.applied}개 패치)`);
          if (patchInfo.failed.length > 0) {
            toast.warning(`${patchInfo.applied}개 수정 완료, ${patchInfo.failed.length}개 실패`);
          } else {
            toast.success(`${patchInfo.applied}개 부분 수정 완료!`);
          }
        } else {
          pushHistory(css, "AI 테마 생성");
        }
      },
      [pushHistory]
    ),
    onUsageLimitReached: useCallback(() => {
      setShowSubscriptionModal(true);
    }, []),
  });

  // 모델 로드
  useEffect(() => {
    cssAi.loadModels();
  }, []);

  useEffect(() => {
    if (showSubscriptionModal) {
      void cssAi.loadUsageStatus();
    }
  }, [showSubscriptionModal]);

  useEffect(() => {
    if (showSubscriptionModal && cssAi.usage && cssAi.usage.remaining > 0) {
      setShowSubscriptionModal(false);
    }
  }, [cssAi.usage, showSubscriptionModal]);

  // Undo/Redo 핸들러
  const handleUndo = useCallback(() => {
    const entry = undo();
    if (entry) {
      setCssCode(entry.css);
      toast.info(`되돌림: ${entry.label}`);
    }
  }, [undo]);

  const handleRedo = useCallback(() => {
    const entry = redo();
    if (entry) {
      setCssCode(entry.css);
      toast.info(`다시 실행: ${entry.label}`);
    }
  }, [redo]);

  const handleGoToHistory = useCallback(
    (index: number) => {
      const entry = goToIndex(index);
      if (entry) {
        setCssCode(entry.css);
        toast.info(`${entry.label}로 이동`);
      }
    },
    [goToIndex]
  );

  // 키보드 단축키
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? handleRedo() : handleUndo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo]);

  // 서버 데이터 동기화
  useLayoutEffect(() => {
    if (!customization) return;
    if (hasUnsavedChanges) return;

    const snapshot = {
      id: customization.id,
      updatedAt: customization.updatedAt,
    };
    const isSameSnapshot =
      lastSyncedRef.current?.id === snapshot.id &&
      lastSyncedRef.current?.updatedAt === snapshot.updatedAt;

    if (isSameSnapshot) return;

    lastSyncedRef.current = snapshot;
    // 기존 분기: layoutType 에 따라 legacy↔customCss / new↔customCssNew 를 편집했다.
    // 신규 레이아웃 강제 이후에는 신규 레이아웃 CSS만 편집한다.
    const css = customization.customCssNew || "";
    setCssCode(css);
    setIsEnabled(customization.isEnabledNew);
    setLayoutType(DEFAULT_CHANNEL_LAYOUT_TYPE);
    setForcedColorMode(
      normalizeChannelColorMode(customization.forcedColorMode)
    );
    setLayoutWidth(customization.layoutWidth ?? DEFAULT_CHANNEL_LAYOUT_WIDTH);
    setHeaderStyle(customization.headerStyle ?? DEFAULT_CHANNEL_HEADER_STYLE);
    setHasUnsavedChanges(false);
    initHistory(css);
  }, [customization, hasUnsavedChanges, initHistory]);

  // 핸들러들
  const handleCssChange = useCallback(
    (value: string) => {
      setCssCode(value);
      setValidationErrors([]);
      // 기존에는 layoutType 에 따라 기존/신규 CSS 필드를 분기했다.
      const savedCss = customization?.customCssNew;
      const savedEnabled = customization?.isEnabledNew;
      setHasUnsavedChanges(
        value !== (savedCss || "") || isEnabled !== savedEnabled
      );
    },
    [customization, isEnabled]
  );

  const handleColorModeChange = useCallback((value: string) => {
    setForcedColorMode(normalizeChannelColorMode(value));
  }, []);

  const handleSaveColorMode = useCallback(async () => {
    try {
      await saveCss.mutateAsync({ forcedColorMode });
      toast.success("색상 모드가 저장되었습니다.");
    } catch {
      toast.error("저장에 실패했습니다.");
    }
  }, [forcedColorMode, saveCss]);

  const handleToggleEnabled = useCallback(
    async (checked: boolean) => {
      setIsEnabled(checked);
      if (customization?.id) {
        try {
          // 기존에는 layoutType === "legacy" 일 때 전용 toggle endpoint 로 분기했다.
          await saveCss.mutateAsync({ isEnabledNew: checked });
          toast.success(checked ? "CSS가 활성화되었습니다." : "CSS가 비활성화되었습니다.");
        } catch {
          setIsEnabled(!checked);
          toast.error("상태 변경에 실패했습니다.");
        }
      } else {
        setHasUnsavedChanges(true);
      }
    },
    [customization, saveCss]
  );

  const handleTemplateSelect = useCallback(
    (template: CssTemplate) => {
      setCssCode(template.css);
      setSelectedTemplateId(template.id);
      setValidationErrors([]);
      setHasUnsavedChanges(true);
      pushHistory(template.css, `템플릿: ${template.name}`);
      toast.success(`'${template.name}' 템플릿이 적용되었습니다.`);
    },
    [pushHistory]
  );

  const handleInspectorToggle = useCallback(() => {
    setInspectorActive((prev) => !prev);
  }, []);

  const handleInspectorResult = useCallback(
    (result: { selector: string } | null) => {
      setInspectorActive(false);
      if (result) setPickedSelector(result.selector);
    },
    []
  );

  const handleInsertSelector = useCallback(
    (selector: string) => {
      const snippet = `\n${selector} {\n  \n}\n`;
      const next = cssCode + snippet;
      setCssCode(next);
      setHasUnsavedChanges(true);
      setValidationErrors([]);
      pushHistory(next, `선택자 삽입`);
      // AI 꾸미기 탭 내부에서 AI 모드였다면 편집 이어가도록 code 모드로 전환
      // (커스텀 CSS 탭은 이미 에디터 단일 레이아웃이라 editorMode 건드리지 않음)
      if (mainTab === "ai-decoration" && editorMode === "ai") {
        setEditorMode("code");
      }
      toast.success("선택자를 에디터에 추가했습니다.");
    },
    [cssCode, editorMode, mainTab, pushHistory]
  );

  const handleClearPickedSelector = useCallback(() => {
    setPickedSelector(null);
  }, []);

  // 기본 설정 탭으로 돌아가면 인스펙터 리셋 (AI 꾸미기/커스텀 CSS 둘 다 인스펙터 사용)
  useEffect(() => {
    if (mainTab === "basic-settings") {
      setInspectorActive(false);
      setPickedSelector(null);
    }
  }, [mainTab]);

  const handleSave = useCallback(async () => {
    if (isCssSizeExceeded(cssCode)) {
      toast.error("CSS 크기가 100KB를 초과합니다.");
      return;
    }
    try {
      // 기존에는 layoutType 에 따라 기존/신규 CSS 저장 필드를 분기했다.
      await saveCss.mutateAsync({ customCssNew: cssCode, isEnabledNew: isEnabled, forcedColorMode });
      setHasUnsavedChanges(false);
      setValidationErrors([]);
      toast.success("CSS가 저장되었습니다.");
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 400) {
        const errorData = error.response.data as CssValidationErrorResponse;
        setValidationErrors(errorData.errors || []);
        toast.error("CSS 검증에 실패했습니다.");
      } else {
        toast.error("저장에 실패했습니다.");
      }
    }
  }, [cssCode, isEnabled, forcedColorMode, saveCss]);

  const handleReset = useCallback(() => {
    // 기존에는 layoutType 에 따라 기존/신규 CSS를 초기화했다.
    setCssCode(customization?.customCssNew || "");
    setIsEnabled(customization?.isEnabledNew || false);
    setForcedColorMode(
      normalizeChannelColorMode(customization?.forcedColorMode)
    );
    setValidationErrors([]);
    setHasUnsavedChanges(false);
    setSelectedTemplateId(undefined);
    toast.info("변경사항이 초기화되었습니다.");
  }, [customization]);

  const handleDelete = useCallback(async () => {
    try {
      await deleteCss.mutateAsync();
      setCssCode("");
      setIsEnabled(false);
      setForcedColorMode(DEFAULT_CHANNEL_COLOR_MODE);
      setHasUnsavedChanges(false);
      setSelectedTemplateId(undefined);
      toast.success("CSS가 삭제되었습니다.");
    } catch {
      toast.error("삭제에 실패했습니다.");
    }
  }, [deleteCss]);

  // 테마 초기화 (저장된 CSS 삭제 + 에디터 비우기 + 히스토리 초기화)
  const [isClearingTheme, setIsClearingTheme] = useState(false);
  const handleClearTheme = useCallback(async () => {
    setIsClearingTheme(true);
    try {
      // 저장된 CSS가 있으면 서버에서도 삭제
      if (customization?.id) {
        await deleteCss.mutateAsync();
      }
      // 로컬 상태 초기화
      setCssCode("");
      setIsEnabled(false);
      setForcedColorMode(DEFAULT_CHANNEL_COLOR_MODE);
      setHasUnsavedChanges(false);
      setSelectedTemplateId(undefined);
      setHasAiGeneratedCss(false);
      setValidationErrors([]);
      initHistory("");
      toast.success("테마가 초기화되었습니다.");
    } catch {
      toast.error("초기화에 실패했습니다.");
    } finally {
      setIsClearingTheme(false);
    }
  }, [customization?.id, deleteCss, initHistory]);

  const handleSendMessage = useCallback(
    (customMessage?: string) => {
      cssAi.sendMessage(cssCode, customMessage);
    },
    [cssAi, cssCode]
  );

  const isLoading = isChannelLoading || isPermissionLoading || isCustomizationLoading;

  // 권한 없음 화면들
  // 매니저인데 소유자가 Pro가 아닌 경우
  if (!permission?.isOwner && !isOwnerProSubscriber) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="채널 꾸미기"
          description="채널 테마, 배경 및 디자인을 커스텀 CSS로 꾸밀 수 있습니다."
          icon={Paintbrush}
        />
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="size-16 rounded-full bg-indigo-500/10 flex items-center justify-center mb-4">
              <Lock className="size-8 text-indigo-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">채널 소유자의 PRO 구독이 필요합니다</h3>
            <p className="text-muted-foreground max-w-md mb-6">
              채널 꾸미기 기능을 사용하려면 채널 소유자가 PRO를 구독해야 합니다.
              <br />
              채널 소유자에게 PRO 구독을 권유해보세요!
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasCustomizationPermission) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="채널 꾸미기"
          description="채널 테마, 배경 및 디자인을 커스텀 CSS로 꾸밀 수 있습니다."
          icon={Paintbrush}
        />
        <Alert variant="destructive" className="mt-6">
          <AlertCircle className="size-4" />
          <AlertTitle>접근 권한이 없습니다</AlertTitle>
          <AlertDescription>
            채널 소유자이거나 커스터마이징 관리 권한이 있는 매니저만 사용할 수 있습니다.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (customizationError) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="채널 꾸미기"
          description="채널 테마, 배경 및 디자인을 커스텀 CSS로 꾸밀 수 있습니다."
          icon={Paintbrush}
        />
        <Alert variant="destructive" className="mt-6">
          <AlertCircle className="size-4" />
          <AlertTitle>데이터를 불러올 수 없습니다</AlertTitle>
          <AlertDescription>잠시 후 다시 시도해주세요.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className={`p-6 ${mainTab !== "basic-settings" ? "h-[calc(100vh-64px)] flex flex-col" : ""}`}>
      <ManagementHeader
        title="채널 꾸미기"
        description="AI로 스타일을 생성하거나 직접 CSS를 편집할 수 있습니다."
        icon={Paintbrush}
      >
        {/* CSS 편집 탭(AI 꾸미기 / 커스텀 CSS)에서만 CSS 관련 컨트롤 표시 */}
        {mainTab !== "basic-settings" && (
          <div className="flex items-center gap-4">
            {/* 상태 인디케이터 */}
            {hasUnsavedChanges && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                저장되지 않음
              </span>
            )}

            {/* 활성화 토글 (Preview 모드에서는 비활성화) */}
            <div className="flex items-center gap-2 pl-3 border-l">
              <Switch
                id="css-enabled"
                checked={isEnabled}
                onCheckedChange={handleToggleEnabled}
                disabled={isLoading || saveCss.isPending || isPreviewMode}
              />
              <Label htmlFor="css-enabled" className="text-sm text-muted-foreground">
                {isPreviewMode ? "미리보기" : isEnabled ? "적용 중" : "미적용"}
              </Label>
            </div>

            {/* 저장 버튼 또는 구독 유도 버튼 */}
            {isPreviewMode ? (
              <AnimatedGradientButton asChild size="sm">
                <Link href="/subscription" className="gap-2">
                  <Lock className="size-4" />
                  PRO 구독하고 저장하기
                </Link>
              </AnimatedGradientButton>
            ) : (
              <Button
                onClick={handleSave}
                disabled={isLoading || saveCss.isPending || !hasUnsavedChanges || isCssSizeExceeded(cssCode)}
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
            )}
          </div>
        )}
      </ManagementHeader>

      {/* 메인 탭 (AI 꾸미기 / 기본 설정) */}
      <PillTabs
        tabs={mainTabItems}
        activeTab={mainTab}
        onTabChange={setMainTab}
        className="mt-4"
      />

      {mainTab !== "basic-settings" && validationErrors.length > 0 && (
        <Alert variant="destructive" className="mt-4">
          <AlertCircle className="size-4" />
          <AlertTitle>CSS 검증 오류</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside mt-2 space-y-1">
              {validationErrors.map((error, index) => (
                <li key={index}>
                  {error.line && error.column ? `라인 ${error.line}, 컬럼 ${error.column}: ` : ""}
                  {error.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {mainTab === "ai-decoration" && (
        <>
          <DecorationToolbar
            editorMode={editorMode}
            onEditorModeChange={setEditorMode}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            cssHistory={cssHistory}
            cssHistoryIndex={cssHistoryIndex}
            onGoToHistory={handleGoToHistory}
            hasUnsavedChanges={hasUnsavedChanges}
            onReset={handleReset}
            onDelete={handleDelete}
            showDelete={!!customization?.id}
            onClearTheme={handleClearTheme}
            isClearingTheme={isClearingTheme}
          />

      <div className="flex-1 min-h-0">
        {/* AI 모드 + CSS 없음 상태: 채팅만 풀스크린 */}
        {editorMode === "ai" && !hasAiGeneratedCss && !customization?.customCss ? (
          <div className="h-full rounded-lg border">
            <AiMainPanel
              models={cssAi.models}
              selectedModel={cssAi.selectedModel}
              onModelChange={cssAi.setSelectedModel}
              isLoadingModels={cssAi.isLoadingModels}
              aiPrompt={cssAi.prompt}
              setAiPrompt={cssAi.setPrompt}
              aiMessages={cssAi.messages}
              setAiMessages={cssAi.setMessages}
              aiIsStreaming={cssAi.isStreaming}
              aiIsRequesting={cssAi.isRequesting}
              aiMeta={cssAi.meta}
              usage={cssAi.usage}
              onSendMessage={handleSendMessage}
              onStopStream={cssAi.stopStream}
              onReset={cssAi.reset}
            />
          </div>
        ) : (
          /* CSS 생성됨 또는 코드 모드: 분할 뷰 */
          <ResizablePanelGroup direction="horizontal" className="h-full rounded-lg border">
            <ResizablePanel defaultSize={33} minSize={25}>
              {editorMode === "ai" ? (
                <AiMainPanel
                  models={cssAi.models}
                  selectedModel={cssAi.selectedModel}
                  onModelChange={cssAi.setSelectedModel}
                  isLoadingModels={cssAi.isLoadingModels}
                  aiPrompt={cssAi.prompt}
                  setAiPrompt={cssAi.setPrompt}
                  aiMessages={cssAi.messages}
                  setAiMessages={cssAi.setMessages}
                  aiIsStreaming={cssAi.isStreaming}
                  aiIsRequesting={cssAi.isRequesting}
                  aiMeta={cssAi.meta}
                  usage={cssAi.usage}
                  onSendMessage={handleSendMessage}
                  onStopStream={cssAi.stopStream}
                  onReset={cssAi.reset}
                />
              ) : (
                <div className="h-full p-2">
                  <CssEditor
                    value={cssCode}
                    onChange={handleCssChange}
                    disabled={isLoading}
                    height="100%"
                    className="h-full"
                  />
                </div>
              )}
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={67} minSize={40}>
              {channel?.webPath && (
                <CssPreview
                  webPath={channel.webPath}
                  css={cssCode}
                  colorMode={forcedColorMode}
                  className="h-full"
                  inspectorActive={inspectorActive}
                  onInspectorToggle={handleInspectorToggle}
                  onInspectorResult={handleInspectorResult}
                  pickedSelector={pickedSelector}
                  onInsertSelector={handleInsertSelector}
                  onClearPickedSelector={handleClearPickedSelector}
                />
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
        </>
      )}

      {/* 커스텀 CSS 탭 콘텐츠 (오버레이 커스텀 CSS 와 동일한 에디터+미리보기 분할 레이아웃) */}
      {mainTab === "custom-css" && (
        <div className="flex-1 min-h-0 mt-4">
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
                    disabled={!canUndo}
                    className="h-8 gap-1"
                  >
                    <Undo2 className="size-4" />
                    <span className="hidden sm:inline">되돌리기</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRedo}
                    disabled={!canRedo}
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
                    disabled={!customization?.id || deleteCss.isPending}
                    className="h-8 gap-1 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    <span className="hidden sm:inline">삭제</span>
                  </Button>
                </div>
                <div className="flex-1 min-h-0 p-2">
                  <CssEditor
                    value={cssCode}
                    onChange={handleCssChange}
                    disabled={isLoading}
                    height="100%"
                    className="h-full"
                  />
                </div>
                <div className="border-t px-3 py-2 bg-muted/20 text-xs text-muted-foreground">
                  루트 선택자:{" "}
                  <code className="bg-background border px-1.5 py-0.5 rounded text-[11px]">
                    #channel-container
                  </code>{" "}
                  · 우측{" "}
                  <span className="font-medium">요소 선택</span>으로 원하는
                  영역의 셀렉터를 추출해 에디터에 삽입할 수 있어요.
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={58} minSize={40}>
              {channel?.webPath && (
                <CssPreview
                  webPath={channel.webPath}
                  css={cssCode}
                  colorMode={forcedColorMode}
                  className="h-full"
                  inspectorActive={inspectorActive}
                  onInspectorToggle={handleInspectorToggle}
                  onInspectorResult={handleInspectorResult}
                  pickedSelector={pickedSelector}
                  onInsertSelector={handleInsertSelector}
                  onClearPickedSelector={handleClearPickedSelector}
                />
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}

      {/* 기본 설정 탭 콘텐츠 */}
      {mainTab === "basic-settings" && (
        <div className="mt-4">
          <SettingsPanel>
            <SettingsSectionHeader title="레이아웃" />
            <SettingsRow title="레이아웃 종류" description="메뉴 사이드바형">
              <div>
                <VisualOptionSelector
                  value={layoutType}
                  onChange={() => {}}
                  disabled
                  options={[
                    {
                      value: "new",
                      label: "신규 레이아웃",
                      description: "메뉴 사이드바형",
                      preview: <LayoutNewPreview />,
                    },
                  ]}
                />
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  기존 레이아웃은 2026년 7월 업데이트 이후 지원 중단되었습니다.
                </p>
              </div>
            </SettingsRow>

            <SettingsRow title="콘텐츠 너비" description="와이드 모드는 PRO 전용">
              <VisualOptionSelector
                value={layoutWidth}
                onChange={(value) => setLayoutWidth(value as ChannelLayoutWidth)}
                disabled={isLoading}
                options={[
                  { value: "default", label: "기본", description: "고정 너비 컨테이너", preview: <LayoutDefaultPreview /> },
                  { value: "wide", label: "와이드", description: "전체 너비 활용", preview: <LayoutWidePreview /> },
                ]}
              />
            </SettingsRow>

            <SettingsRow title="상단 보기 방식" description="분리형은 PRO 전용">
              <VisualOptionSelector
                value={headerStyle}
                onChange={(value) => setHeaderStyle(value as ChannelHeaderStyle)}
                disabled={isLoading}
                options={[
                  { value: "wide", label: "와이드형", description: "배너가 전체 너비", preview: <HeaderWidePreview /> },
                  { value: "separated", label: "분리형", description: "배너가 둥근 카드형", preview: <HeaderSeparatedPreview /> },
                ]}
              />
            </SettingsRow>

            <SettingsSectionHeader title="테마" />
            <SettingsRow title="색상 모드 강제" description="커스텀 CSS 활성화 시 적용">
              <VisualOptionSelector
                value={forcedColorMode}
                onChange={handleColorModeChange}
                disabled={isLoading}
                options={[
                  { value: "system", label: "시스템", description: "기기 설정에 따름", preview: <ColorModeSystemPreview /> },
                  { value: "light", label: "라이트", preview: <ColorModeLightPreview /> },
                  { value: "dark", label: "다크", preview: <ColorModeDarkPreview /> },
                ]}
              />
            </SettingsRow>

            <SettingsSectionHeader title="배너" />
            <SettingsRow title="상단 배너" description="권장: 1480x192px">
              <BannerUploadField
                label=""
                imageUrl={channel?.topBannerUrl ?? null}
                onImageChange={(url) => handleBannerChange("topBannerUrl", url)}
                previewClassName="w-full aspect-[1480/192]"
                disabled={!canSave}
              />
            </SettingsRow>

            <SettingsRow title="좌/우측 배너" description="권장: 150x450px">
              <div className="grid grid-cols-2 gap-4">
                <BannerUploadField
                  label="좌측"
                  imageUrl={channel?.leftBannerUrl ?? null}
                  onImageChange={(url) => handleBannerChange("leftBannerUrl", url)}
                  previewClassName="w-24 aspect-[150/450] max-h-64"
                  disabled={!canSave}
                />
                <BannerUploadField
                  label="우측"
                  imageUrl={channel?.rightBannerUrl ?? null}
                  onImageChange={(url) => handleBannerChange("rightBannerUrl", url)}
                  previewClassName="w-24 aspect-[150/450] max-h-64"
                  disabled={!canSave}
                />
              </div>
            </SettingsRow>

            <SettingsRow title="배너 링크" description="클릭 시 이동할 URL">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">좌측 배너 링크</Label>
                  <Input
                    type="url"
                    placeholder="https://"
                    value={leftBannerLink}
                    onChange={(e) => setLeftBannerLink(e.target.value)}
                    disabled={!canSave}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">우측 배너 링크</Label>
                  <Input
                    type="url"
                    placeholder="https://"
                    value={rightBannerLink}
                    onChange={(e) => setRightBannerLink(e.target.value)}
                    disabled={!canSave}
                  />
                </div>
              </div>
            </SettingsRow>

            <div className="flex items-center justify-end gap-3 py-4">
              {hasBasicSettingsChanges && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  저장되지 않은 변경사항이 있습니다
                </span>
              )}
              {isPreviewMode ? (
                <AnimatedGradientButton asChild size="sm">
                  <Link href="/subscription" className="gap-2">
                    <Lock className="size-4" />
                    PRO 구독하고 저장하기
                  </Link>
                </AnimatedGradientButton>
              ) : (
                <Button
                  onClick={handleSaveBasicSettings}
                  disabled={
                    isLoading ||
                    saveCss.isPending ||
                    !hasBasicSettingsChanges ||
                    !canSave
                  }
                >
                  {saveCss.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  저장
                </Button>
              )}
            </div>
          </SettingsPanel>
        </div>
      )}

      {/* CSS 생성 제한 도달 시 모달 */}
      <Dialog open={showSubscriptionModal} onOpenChange={setShowSubscriptionModal}>
        <DialogContent className="sm:max-w-md">
          {isOwnerProSubscriber ? (
            /* Pro 사용자: 할당량 소진 안내 */
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="text-2xl">⏰</span>
                  오늘 할당량을 모두 사용했습니다
                </DialogTitle>
                <DialogDescription className="pt-2">
                  리셋 시간 이후 다시 이용해주세요.
                </DialogDescription>
              </DialogHeader>

              <div className="py-4">
                {cssAi.usage && (
                  <div className="rounded-lg bg-muted/50 p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">
                      {cssAi.usage.used}/{cssAi.usage.limit}회
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">오늘 사용량</p>
                    {cssAi.usage.resets_at && (
                      <p className="text-sm text-muted-foreground mt-3">
                        리셋 시간: {new Date(cssAi.usage.resets_at).toLocaleString("ko-KR")}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <Button onClick={() => setShowSubscriptionModal(false)} className="w-full">
                확인
              </Button>
            </>
          ) : (
            /* 비Pro 사용자: 구독 유도 */
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="text-2xl">✨</span>
                  무료 체험이 종료되었습니다
                </DialogTitle>
                <DialogDescription className="pt-2">
                  AI로 생성한 테마가 마음에 드셨나요?
                  <br />
                  PRO 구독으로 더 많은 테마를 만들어보세요!
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="size-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="size-3 text-green-500" />
                    </div>
                    <p className="text-sm">하루 <strong>20회</strong> CSS 생성 (무료: 2회)</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="size-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="size-3 text-green-500" />
                    </div>
                    <p className="text-sm">생성한 테마 <strong>저장 및 적용</strong> 가능</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="size-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="size-3 text-green-500" />
                    </div>
                    <p className="text-sm">다양한 <strong>PRO 전용</strong> 기능 해제</p>
                  </div>
                </div>

                {cssAi.usage && (
                  <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                    오늘 사용: {cssAi.usage.used}/{cssAi.usage.limit}회
                    {cssAi.usage.resets_at && (
                      <span className="block text-xs mt-1">
                        리셋: {new Date(cssAi.usage.resets_at).toLocaleString("ko-KR")}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="mb-3">
                <ProAnnualPromotionBanner variant="inline" />
              </div>

              <div className="flex flex-col gap-2">
                <AnimatedGradientButton asChild className="w-full">
                  <Link href="/subscription">
                    PRO 구독하기
                  </Link>
                </AnimatedGradientButton>
                <Button
                  variant="ghost"
                  onClick={() => setShowSubscriptionModal(false)}
                  className="w-full"
                >
                  나중에 하기
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
