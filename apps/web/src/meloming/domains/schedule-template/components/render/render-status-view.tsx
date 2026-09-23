"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/meloming/shared/components/ui/alert";
import type { ScheduleImageRender } from "@/meloming/domains/schedule-template/types";

interface RenderStatusViewProps {
  render: ScheduleImageRender;
  onDownload: () => void;
  onRetry: () => void;
  isDownloading?: boolean;
  isRetrying?: boolean;
}

/**
 * 렌더 단일 진행 상태 UI.
 *
 * - QUEUED / RENDERING: 스피너 + 경과 시간 (경과는 updatedAt 대신 createdAt
 *   기반으로 표시해 사용자 인식 기준 "요청 후 얼마나 지났는지" 를 보여준다)
 * - DONE: 이미지 미리보기 + 다운로드 버튼
 * - FAILED: 에러 메시지 + 재시도 버튼
 *
 * 폴링 자체는 상위(`useScheduleRender`) 에서 처리하고 이 컴포넌트는
 * status 분기만 담당한다 (단일 책임 원칙).
 */
export function RenderStatusView({
  render,
  onDownload,
  onRetry,
  isDownloading = false,
  isRetrying = false,
}: RenderStatusViewProps) {
  if (render.status === "DONE") {
    return (
      <DoneView
        render={render}
        onDownload={onDownload}
        isDownloading={isDownloading}
      />
    );
  }

  if (render.status === "FAILED") {
    return (
      <FailedView
        errorMessage={render.errorMessage}
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  }

  // QUEUED / RENDERING
  return <InProgressView status={render.status} createdAt={render.createdAt} />;
}

function InProgressView({
  status,
  createdAt,
}: {
  status: "QUEUED" | "RENDERING";
  createdAt: string;
}) {
  // 1초 간격으로 tick 을 올려 경과 초를 매 render 계산.
  // 직접 elapsed 를 state 에 넣으면 useEffect 내부 setState 가 되어
  // react-hooks/set-state-in-effect 룰에 걸린다. tick 을 외부 타이머로
  // bump 하고 파생값은 render 시점에 계산한다.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  // createdAt 이 바뀌거나 tick 이 오르면 자동 재계산
  void tick;
  const elapsedSec = computeElapsed(createdAt);

  const title = status === "QUEUED" ? "대기 중..." : "이미지 생성 중...";
  const description =
    status === "QUEUED"
      ? "다른 작업이 처리되는 동안 잠시 기다리고 있어요."
      : "주간 시간표 이미지를 합성하고 있어요. 보통 몇 초면 끝나요.";

  return (
    <Card data-testid="render-status-in-progress">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="size-8 animate-spin text-primary" />
        <div className="space-y-1">
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          경과 시간 {elapsedSec}초
        </p>
      </CardContent>
    </Card>
  );
}

function DoneView({
  render,
  onDownload,
  isDownloading,
}: {
  render: ScheduleImageRender;
  onDownload: () => void;
  isDownloading: boolean;
}) {
  return (
    <div className="space-y-3" data-testid="render-status-done">
      <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4" />
        <span className="font-medium">이미지가 준비됐어요</span>
      </div>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {render.imageUrl ? (
            // 외부 S3 이미지. next/image 대신 일반 <img> — 외부 도메인 화이트리스트
            // 없이도 표시 가능하고, 다운로드 fetch 와 같은 경로라 CORS 충돌도 일관.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={render.imageUrl}
              alt="생성된 주간 시간표 이미지"
              className="block w-full"
              loading="lazy"
            />
          ) : (
            <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
              이미지 URL 을 불러오지 못했어요.
            </div>
          )}
        </CardContent>
      </Card>
      {/* F14: 모바일은 버튼 full-width — 작은 화면에서 우측 정렬 버튼은 탭하기 어려움.
          breakpoint 는 `useIsMobile` (768px) 와 일치시켜 — `sm:`(640) 쓰면 640~767px 구간에서
          에디터/렌더 페이지의 JS 분기(모바일)와 CSS(데스크톱) 가 어긋난다. */}
      <div className="flex flex-col md:flex-row md:justify-end">
        <Button
          type="button"
          onClick={onDownload}
          disabled={!render.imageUrl || isDownloading}
          className="w-full md:w-auto"
        >
          {isDownloading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              다운로드 중…
            </>
          ) : (
            <>
              <Download className="size-4" />
              PNG 다운로드
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function FailedView({
  errorMessage,
  onRetry,
  isRetrying,
}: {
  errorMessage: string | null;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <Alert variant="destructive" data-testid="render-status-failed">
      <AlertCircle className="size-4" />
      <AlertTitle>이미지 생성에 실패했어요</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>
          {errorMessage ??
            "잠시 후 다시 시도해주세요. 문제가 계속되면 운영팀에 알려주세요."}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onRetry}
          disabled={isRetrying}
        >
          {isRetrying ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          다시 시도
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function computeElapsed(createdAt: string): number {
  const started = new Date(createdAt).getTime();
  if (!Number.isFinite(started)) return 0;
  const delta = Math.max(0, Date.now() - started);
  return Math.floor(delta / 1_000);
}
