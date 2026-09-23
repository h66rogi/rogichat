"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Download, ImageDown, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/meloming/shared/components/ui/button";
import { Label } from "@/meloming/shared/components/ui/label";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { useChannelSchedules } from "@/meloming/domains/schedule/hooks/use-schedules";
import {
  useCreateScheduleRender,
  usePreviewPng,
  useScheduleRender,
  useScheduleTemplates,
} from "@/meloming/domains/schedule-template/hooks";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { ManagementHeader } from "@/meloming/domains/channel/components/management/management-header";
import { TemplatePicker } from "./template-picker";
import { WeekPicker } from "./week-picker";
import { RenderStatusView } from "./render-status-view";
import { TemplateCanvasPreview } from "./template-canvas-preview";
import {
  buildScheduleImageFilename,
  downloadImageAsPng,
} from "./download-util";
import {
  getKstWeekStart,
  toWeekStartDateKey,
  toWeekStartIso,
} from "./week-utils";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { useSnsCredentials } from "@/meloming/domains/sns-credentials/hooks";
import type { SnsPlatform } from "@/meloming/domains/sns-credentials/types/sns-platform";
import {
  RenderPublicationsList,
  RenderPublishDialog,
} from "@/meloming/domains/schedule-sns-publications/components";
import { coerceTemplateSpec } from "@/meloming/domains/schedule-template/components/editor";
import type { TemplateSpecV1 } from "@/meloming/domains/schedule-template/types/template-spec";
import { buildPreviewContext } from "@/meloming/domains/schedule-template/utils/build-preview-context";
import { computePreviewTriggerKey } from "@/meloming/domains/schedule-template/utils/compute-preview-trigger-key";
import { downloadBlobAsPng } from "@/meloming/domains/schedule-template/utils/preview-to-png";

/**
 * 미리보기 PNG 출력의 최대 가로 픽셀. 베이스 이미지가 4K 이상으로 큰 경우
 * html-to-image 캡처 비용/메모리가 폭증할 수 있어 상한을 둔다.
 */
const PREVIEW_MAX_PIXEL_WIDTH = 1080;

/**
 * 화면에 표시할 미리보기 영역 폭(px). transform: scale 로 디자인 좌표 공간을
 * 축소해 화면에 맞춘다.
 */
const PREVIEW_DISPLAY_WIDTH = 480;

interface ScheduleImageContentProps {
  /** 채널 식별자. 상위에서 prop 으로 받으면 useParams 대신 우선 사용 */
  user?: string;
}

/**
 * 시간표 이미지 생성 메인 컨테이너 (F5).
 *
 * - 템플릿 선택 + 주 선택 → "이미지 생성" POST → renderId 폴링 → DONE/FAILED
 * - ChannelManageContent > schedule-image 섹션에서 렌더된다.
 *
 * 상태 관리:
 *  - selectedTemplateId: 템플릿 드롭다운 선택값 (기본값: isDefault 템플릿)
 *  - weekStart: KST 월요일 00:00 의 UTC Date
 *  - currentRenderId: 진행 중/완료된 렌더. null 이면 아직 요청 안 함
 *
 * 폴링은 `useScheduleRender(currentRenderId)` 에 위임 (F1). DONE 이 되면
 * refetchInterval 이 자동으로 멈춘다.
 */
export function ScheduleImageContent({ user: propUser }: ScheduleImageContentProps = {}) {
  const params = useParams();
  const identifier = propUser ?? (params?.user as string) ?? "";

  const { data: channel, isLoading: isChannelLoading } = useChannel(identifier, {
    enabled: !!identifier,
  });
  const channelId = channel?.id;

  const {
    data: templates,
    isLoading: isTemplatesLoading,
  } = useScheduleTemplates(channelId ?? 0, { enabled: !!channelId });

  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null,
  );
  const [weekStart, setWeekStart] = useState<Date>(() => getKstWeekStart());
  const [currentRenderId, setCurrentRenderId] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  // 새 publish 가 일어났을 때 폴링 timeout 을 풀기 위한 신호. bump 시 list 가
  // resetPollingTimeout() 을 호출한다.
  const [pollingResetSignal, setPollingResetSignal] = useState(0);
  // html-to-image 가 캡처할 디자인 공간 노드.
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);

  const router = useRouter();
  const { isAuthenticated } = useAuth();
  // SNS 자격증명은 publish 버튼/탭 가용성 판정에만 사용 — 비로그인 시 query 비활성으로
  // 401 노이즈 방지.
  const { data: snsCredentials } = useSnsCredentials({
    enabled: isAuthenticated,
  });

  const availablePlatforms = useMemo<SnsPlatform[]>(() => {
    if (!snsCredentials) return [];
    return snsCredentials
      .filter((c) => c.isConnected && c.isActive)
      .map((c) => c.platform);
  }, [snsCredentials]);
  const hasAnyConnectedSns = availablePlatforms.length > 0;

  // 기본 템플릿 자동 선택 (목록 로드 완료 + 유저 선택 없을 때만)
  useEffect(() => {
    if (selectedTemplateId !== null) return;
    if (!templates || templates.length === 0) return;
    const defaultTemplate =
      templates.find((t) => t.isDefault) ?? templates[0];
    setSelectedTemplateId(defaultTemplate.id);
  }, [templates, selectedTemplateId]);

  const createMutation = useCreateScheduleRender();
  const renderQuery = useScheduleRender(currentRenderId ?? undefined, {
    enabled: currentRenderId !== null,
  });

  const isRenderInFlight = useMemo(() => {
    if (createMutation.isPending) return true;
    const status = renderQuery.data?.status;
    return status === "QUEUED" || status === "RENDERING";
  }, [createMutation.isPending, renderQuery.data?.status]);

  // ── 클라이언트 미리보기 (F9) ───────────────────────────────────────────────
  // 선택된 템플릿 객체. 템플릿 목록이 채워지고 selectedTemplateId 가 정해진
  // 후에만 truthy.
  const selectedTemplate = useMemo(() => {
    if (!templates || selectedTemplateId === null) return undefined;
    return templates.find((t) => t.id === selectedTemplateId);
  }, [templates, selectedTemplateId]);

  // 슬롯 정의. 손상된 spec 은 빈 슬롯으로 안전 복구 (에디터와 동일 정책).
  const previewSpec = useMemo<{
    version: 1;
    slots: TemplateSpecV1["slots"];
  }>(() => {
    if (!selectedTemplate) return { version: 1, slots: [] };
    return coerceTemplateSpec(selectedTemplate.templateSpec);
  }, [selectedTemplate]);

  // 미리보기에 들어갈 주간 일정. weekStart 부터 7일치를 from/to 로 가져온다.
  const weekEnd = useMemo(
    () => new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    [weekStart],
  );
  const { data: schedulesData } = useChannelSchedules(
    channelId ?? 0,
    {
      from: weekStart.toISOString(),
      to: weekEnd.toISOString(),
      limit: 100,
    },
    { enabled: !!channelId },
  );

  // 미리보기 binding 컨텍스트.
  const previewContext = useMemo(() => {
    if (!channel) return undefined;
    return buildPreviewContext({
      channel: { name: channel.name, profileImageUrl: channel.profileImageUrl },
      weekStartAt: weekStart,
      schedules: schedulesData?.items ?? [],
    });
  }, [channel, weekStart, schedulesData]);

  // 미리보기 표시 폭. 디자인 폭이 화면보다 좁으면 1:1, 그 외엔 축소.
  const previewDisplayWidth = useMemo(() => {
    if (!selectedTemplate) return PREVIEW_DISPLAY_WIDTH;
    return Math.min(PREVIEW_DISPLAY_WIDTH, selectedTemplate.baseImageW);
  }, [selectedTemplate]);

  // 미리보기 PNG 출력 폭. 디자인 폭 1080 이하면 그대로, 그 이상이면 1080 으로 캡.
  // baseImageW > cap 인 경우, html-to-image 의 `width/height` 는 자연 디자인 폭으로
  // 두고 (= 모든 슬롯이 SVG viewBox 안에 다 그려지도록) `canvasWidth/canvasHeight`
  // 만 cap 으로 다운샘플한다. width 만 cap 으로 주면 SVG viewBox 가 좁아져서
  // x > cap 위치의 슬롯이 짤린다.
  const previewOutputWidth = useMemo(() => {
    if (!selectedTemplate) return PREVIEW_MAX_PIXEL_WIDTH;
    return Math.min(selectedTemplate.baseImageW, PREVIEW_MAX_PIXEL_WIDTH);
  }, [selectedTemplate]);
  const previewOutputHeight = useMemo(() => {
    if (!selectedTemplate) return undefined;
    const ratio = selectedTemplate.baseImageH / selectedTemplate.baseImageW;
    return Math.round(previewOutputWidth * ratio);
  }, [selectedTemplate, previewOutputWidth]);

  // 디바운스 트리거 — slot/binding/template/week + 일정 콘텐츠가 바뀔 때 다시 캡처.
  // total 만 보면 동일 개수 일정의 title/startAt/endAt/isCanceled 변경이 누락되어
  // 미리보기가 stale 해진다 (Codex F9 IMPORTANT). 내용 해시로 정확하게 트리거.
  const previewTriggerKey = useMemo(() => {
    if (!selectedTemplate || !previewContext) return null;
    return computePreviewTriggerKey({
      templateId: selectedTemplate.id,
      templateUpdatedAt: selectedTemplate.updatedAt,
      weekStartMs: weekStart.getTime(),
      schedules: schedulesData?.items ?? [],
    });
  }, [selectedTemplate, previewContext, weekStart, schedulesData?.items]);

  const previewPng = usePreviewPng(previewCanvasRef, previewTriggerKey, {
    enabled:
      !!selectedTemplate && !!previewContext && !!selectedTemplate.baseImageUrl,
    debounceMs: 500,
    backgroundColor: "#ffffff",
    // SVG 는 자연 디자인 좌표로 — 슬롯이 짤리지 않게.
    width: selectedTemplate?.baseImageW,
    height: selectedTemplate?.baseImageH,
    // 캔버스(=결과 PNG) 만 1080 cap 으로 다운샘플.
    canvasWidth: previewOutputWidth,
    canvasHeight: previewOutputHeight,
  });

  // CORS 등으로 미리보기 캡처가 실패하면 한 번만 안내. errorCode 가 변할 때만
  // 새 toast — 같은 코드가 유지되면 추가 알림 안 함.
  const lastErrorCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const code = previewPng.errorCode;
    if (code === null) {
      lastErrorCodeRef.current = null;
      return;
    }
    if (lastErrorCodeRef.current === code) return;
    lastErrorCodeRef.current = code;
    if (code === "CORS") {
      toast.warning(
        "미리보기를 만들 수 없어요. 서버 렌더로 확인해주세요.",
      );
    } else {
      toast.warning(
        "미리보기 변환 중 일시적인 문제가 있어요. 서버 렌더를 사용해 주세요.",
      );
    }
  }, [previewPng.errorCode]);

  const handlePreviewDownload = useCallback(() => {
    const blob = previewPng.blob;
    if (!blob) {
      toast.error("미리보기가 아직 준비되지 않았어요.");
      return;
    }
    const filename = buildScheduleImageFilename(
      identifier,
      toWeekStartDateKey(weekStart),
    );
    downloadBlobAsPng(blob, `${filename}-preview`);
  }, [identifier, previewPng.blob, weekStart]);

  const handleSubmit = useCallback(async () => {
    if (!channelId) {
      toast.error("채널 정보를 불러오는 중이에요. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (!selectedTemplateId) {
      toast.error("사용할 템플릿을 선택해주세요.");
      return;
    }

    try {
      const created = await createMutation.mutateAsync({
        channelId,
        templateId: selectedTemplateId,
        weekStartAt: toWeekStartIso(weekStart),
      });
      setCurrentRenderId(created.id);
      toast.success("이미지 생성을 요청했어요. 잠시만 기다려주세요.");
    } catch (error) {
      toast.error(
        extractApiErrorMessage(
          error,
          "이미지 생성 요청에 실패했어요. 잠시 후 다시 시도해주세요.",
        ),
      );
    }
  }, [channelId, createMutation, selectedTemplateId, weekStart]);

  const handleDownload = useCallback(async () => {
    const imageUrl = renderQuery.data?.imageUrl;
    const renderedWeekStartAt = renderQuery.data?.weekStartAt;
    if (!imageUrl || !renderedWeekStartAt) return;
    setIsDownloading(true);
    try {
      // 파일명은 UI 의 현재 선택 주차(weekStart) 가 아니라 "실제 렌더된 이미지의
      // weekStartAt" 을 기반으로 만든다. DONE 후 사용자가 주 선택을 바꿔도
      // 다운로드되는 파일은 여전히 원래 렌더된 주의 것이므로, 파일명이
      // 이미지 내용과 불일치하면 안 된다. (Codex review — MINOR)
      const filename = buildScheduleImageFilename(
        identifier,
        toWeekStartDateKey(new Date(renderedWeekStartAt)),
      );
      await downloadImageAsPng(imageUrl, filename);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "다운로드에 실패했어요. 잠시 후 다시 시도해주세요.";
      toast.error(message);
    } finally {
      setIsDownloading(false);
    }
  }, [identifier, renderQuery.data?.imageUrl, renderQuery.data?.weekStartAt]);

  // 재시도: 같은 (template, week) 로 다시 POST → 새 render 로 교체
  const handleRetry = handleSubmit;

  // SNS 게시 버튼 핸들러 — 가용 플랫폼 없으면 SNS 설정 페이지로 안내.
  const handleOpenPublish = useCallback(() => {
    if (!hasAnyConnectedSns) {
      toast.error("연결된 SNS 계정이 없어요. SNS 연동 페이지에서 연결해주세요.", {
        action: {
          label: "SNS 연동 설정",
          onClick: () => {
            router.push(`/channel/${identifier}/manage/sns-settings`);
          },
        },
      });
      return;
    }
    setPublishDialogOpen(true);
  }, [hasAnyConnectedSns, identifier, router]);

  const templatesHref = `/channel/${identifier}/manage/schedule-templates`;
  const disableControls = isRenderInFlight || isChannelLoading;
  const renderStatus = renderQuery.data?.status;
  const canPublish = renderStatus === "DONE" && currentRenderId !== null;

  return (
    <div className="p-6 space-y-6">
      <ManagementHeader
        title="시간표 이미지"
        description="선택한 템플릿과 주간 일정으로 시간표 이미지를 자동 생성해요."
        icon={ImageDown}
      />

      <section className="grid gap-4 md:grid-cols-2" aria-label="렌더 옵션">
        <div className="space-y-2">
          <Label htmlFor="schedule-image-template">템플릿</Label>
          <TemplatePicker
            templates={templates}
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
            isLoading={isTemplatesLoading || isChannelLoading}
            templatesHref={templatesHref}
            disabled={disableControls}
          />
        </div>

        <div className="space-y-2">
          <Label>주간</Label>
          <WeekPicker
            value={weekStart}
            onChange={setWeekStart}
            disabled={disableControls}
          />
        </div>
      </section>

      {/* 클라이언트 미리보기 (F9). 슬롯/주차 변경 시 ~500ms 디바운스로 자동
          업데이트된다. 서버 렌더는 별도 버튼으로 호출. */}
      {selectedTemplate && previewContext && (
        <section
          className="space-y-3 rounded-lg border bg-muted/30 p-4"
          aria-label="미리보기"
          data-testid="schedule-image-preview-section"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">미리보기</h3>
              <p className="text-xs text-muted-foreground">
                슬롯·주차를 바꾸면 약 0.5초 후 자동으로 갱신돼요.
              </p>
            </div>
            {previewPng.isGenerating && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                생성 중…
              </span>
            )}
          </div>
          <div className="flex justify-center">
            <TemplateCanvasPreview
              ref={previewCanvasRef}
              baseImageUrl={selectedTemplate.baseImageUrl}
              baseImageW={selectedTemplate.baseImageW}
              baseImageH={selectedTemplate.baseImageH}
              slots={previewSpec.slots}
              bindingContext={previewContext}
              displayWidth={previewDisplayWidth}
            />
          </div>
        </section>
      )}

      {/* F14: 모바일에서는 액션 버튼 full-width 로 — 작은 화면에서 탭 정확도 개선.
          breakpoint 는 `useIsMobile` (768px) 와 일치시켜 — `sm:`(640) 쓰면 640~767px 구간에서
          에디터/렌더 페이지의 JS 분기(모바일)와 CSS(데스크톱) 가 어긋난다. */}
      <div className="flex flex-col gap-2 md:flex-row md:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={handlePreviewDownload}
          disabled={
            !previewPng.blob ||
            previewPng.isGenerating ||
            !!previewPng.errorCode
          }
          className="w-full md:w-auto"
          data-testid="preview-png-download"
        >
          <Download className="size-4" />
          PNG 다운로드 (미리보기)
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={
            disableControls ||
            !channelId ||
            selectedTemplateId === null ||
            !templates ||
            templates.length === 0
          }
          className="w-full md:w-auto"
          data-testid="server-render-submit"
        >
          {createMutation.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              요청 중…
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              고화질 이미지 만들기 (서버)
            </>
          )}
        </Button>
      </div>

      {renderQuery.data && (
        <RenderStatusView
          render={renderQuery.data}
          onDownload={handleDownload}
          onRetry={handleRetry}
          isDownloading={isDownloading}
          isRetrying={createMutation.isPending}
        />
      )}

      {/* SNS 게시 영역 — DONE 렌더에서만 노출. 비로그인/feature off 시 publications
          query 도 enabled=false 로 자연 차단된다. */}
      {canPublish && currentRenderId !== null && (
        <section className="space-y-4" aria-label="SNS 게시">
          {/* F14: 모바일에서는 헤더와 버튼을 세로 스택으로 — title 옆 작은 버튼은 잘 안 보임.
              breakpoint 는 `useIsMobile` (768px) 와 일치시켜 — `sm:`(640) 쓰면 640~767px 구간에서
              에디터/렌더 페이지의 JS 분기(모바일)와 CSS(데스크톱) 가 어긋난다. */}
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <h3 className="text-sm font-semibold">SNS 게시</h3>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleOpenPublish}
              className="w-full md:w-auto"
              data-testid="open-publish-dialog"
            >
              <Send className="size-4" />
              SNS에 게시
            </Button>
          </div>
          <RenderPublicationsList
            renderId={currentRenderId}
            enabled={isAuthenticated}
            pollingResetSignal={pollingResetSignal}
          />
        </section>
      )}

      {currentRenderId !== null && (
        <RenderPublishDialog
          open={publishDialogOpen}
          onOpenChange={setPublishDialogOpen}
          renderId={currentRenderId}
          availablePlatforms={availablePlatforms}
          // 새 publish 직후 폴링 timeout 을 풀어 in-progress 폴링이 즉시 재개되게.
          onPublished={() => setPollingResetSignal((n) => n + 1)}
        />
      )}
    </div>
  );
}
