"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, LayoutTemplate, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/meloming/shared/components/ui/alert";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { useScheduleTemplates } from "@/meloming/domains/schedule-template/hooks";
import type { ScheduleTemplate } from "@/meloming/domains/schedule-template/types";
import { ManagementHeader } from "@/meloming/domains/channel/components/management/management-header";
import { ScheduleTemplateCard } from "./schedule-template-card";
import { ScheduleTemplateCreateDialog } from "./schedule-template-create-dialog";
import { ScheduleTemplateDeleteDialog } from "./schedule-template-delete-dialog";

interface ScheduleTemplateListProps {
  /**
   * 채널 식별자 (URL `[user]` 세그먼트). 상위에서 prop 으로 받으면
   * useParams 대신 이것을 사용. 다른 관리 컴포넌트(EmoticonsManagement)
   * 가 URL 파라미터를 쓰는 패턴과 호환되도록 prop 우선.
   */
  user?: string;
}

/**
 * 시간표 템플릿 관리 메인 화면 (F3).
 *
 * ChannelManageContent > schedule-templates 섹션에서 렌더.
 * - 로딩: skeleton 그리드
 * - 에러: inline error + 재시도 버튼
 * - 빈 상태: 첫 생성 CTA
 * - 정상: 카드 그리드 + 생성/삭제 다이얼로그
 */
export function ScheduleTemplateList({ user: propUser }: ScheduleTemplateListProps = {}) {
  const params = useParams();
  const identifier = propUser ?? (params?.user as string) ?? "";

  const { data: channel, isLoading: isChannelLoading } = useChannel(identifier, {
    enabled: !!identifier,
  });
  const channelId = channel?.id;

  const {
    data: templates,
    isLoading: isListLoading,
    error: listError,
    refetch,
    isFetching,
  } = useScheduleTemplates(channelId ?? 0, { enabled: !!channelId });

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleTemplate | null>(
    null,
  );

  const isLoading = isChannelLoading || isListLoading;

  return (
    <div className="p-6">
      <ManagementHeader
        title="시간표 템플릿"
        description="주간 방송 일정 이미지를 자동 생성할 템플릿을 관리합니다."
        icon={LayoutTemplate}
      >
        <Button
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={!channelId}
        >
          <Plus className="size-4" />
          새 템플릿
        </Button>
      </ManagementHeader>

      {listError && !isLoading ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>템플릿 목록을 불러오지 못했어요.</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>잠시 후 다시 시도하거나 새로고침해주세요.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <TemplateListSkeleton />
      ) : !templates || templates.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} disabled={!channelId} />
      ) : (
        <div
          className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="schedule-template-grid"
        >
          {templates.map((template) => (
            <ScheduleTemplateCard
              key={template.id}
              template={template}
              channelIdentifier={identifier}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {channelId !== undefined && (
        <ScheduleTemplateCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          channelId={channelId}
          channelIdentifier={identifier}
        />
      )}

      <ScheduleTemplateDeleteDialog
        template={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </div>
  );
}

function TemplateListSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="overflow-hidden py-0 gap-0">
          <Skeleton className="aspect-[16/9] w-full" />
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <div className="flex gap-2">
              <Skeleton className="h-8 flex-1" />
              <Skeleton className="h-8 w-9" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({
  onCreate,
  disabled,
}: {
  onCreate: () => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardContent className="py-12 px-6 text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-full bg-muted flex items-center justify-center">
          <LayoutTemplate className="size-7 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">아직 등록된 템플릿이 없어요.</p>
          <p className="text-sm text-muted-foreground">
            베이스 이미지 한 장으로 주간 시간표를 자동 생성할 수 있어요.
            첫 템플릿을 만들어보세요.
          </p>
        </div>
        <Button type="button" onClick={onCreate} disabled={disabled}>
          <Plus className="size-4" />첫 템플릿 만들기
        </Button>
      </CardContent>
    </Card>
  );
}
