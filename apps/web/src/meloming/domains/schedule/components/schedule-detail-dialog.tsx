import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
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
import { Button } from "@/meloming/shared/components/ui/button";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Separator } from "@/meloming/shared/components/ui/separator";
import type {
  Schedule,
  CreateScheduleRequest,
} from "@/meloming/domains/schedule/types/schedule";
import { useDeleteSchedule } from "@/meloming/domains/schedule/hooks/use-schedules";
import { toast } from "sonner";
import {
  Calendar,
  Clock,
  MapPin,
  ExternalLink,
  Eye,
  EyeOff,
} from "lucide-react";
import { ScheduleFormDialog } from "./schedule-form-dialog";
import { cn } from "@/meloming/shared/lib/utils";
import { getStatusMeta } from "@/meloming/domains/schedule/utils/schedule-status";

interface ScheduleDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: Schedule;
  channelId: number;
  canEdit?: boolean;
  onSuccess?: () => void;
}

export function ScheduleDetailDialog({
  open,
  onOpenChange,
  schedule,
  channelId,
  canEdit = false,
  onSuccess,
}: ScheduleDetailDialogProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [duplicateValues, setDuplicateValues] =
    useState<Partial<CreateScheduleRequest> | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const deleteMutation = useDeleteSchedule();

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  };

  // const formatTime = (dateStr: string) => {
  //   const date = new Date(dateStr);
  //   return date.toLocaleTimeString("ko-KR", {
  //     hour: "2-digit",
  //     minute: "2-digit",
  //     hour12: false,
  //   });
  // };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync({
        id: schedule.id,
        channelId,
      });

      toast.success("일정이 삭제되었습니다.");
      setIsDeleteDialogOpen(false);
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error("Failed to delete schedule:", error);
      toast.error("일정 삭제에 실패했습니다.");
    }
  };

  const handleEditSuccess = () => {
    onSuccess?.();
  };

  // 원본 일정을 기준으로 7일 뒤로 옮긴 복제 초기값을 만들어 생성 모드 폼을 연다.
  const handleDuplicate = () => {
    const shiftByWeek = (iso: string) => {
      const d = new Date(iso);
      d.setDate(d.getDate() + 7); // 시각(시/분)은 그대로 유지
      return d.toISOString();
    };

    const values: Partial<CreateScheduleRequest> = {
      title: `${schedule.title} (복제)`,
      content: schedule.content ?? undefined,
      status: schedule.status,
      visibility: schedule.visibility,
      location: schedule.location ?? undefined,
      externalUrl: schedule.externalUrl ?? undefined,
      allDay: schedule.allDay,
      startAt: shiftByWeek(schedule.startAt),
      // endAt이 있으면 동일하게 +7일 이동하여 기간(duration) 유지
      endAt: schedule.endAt ? shiftByWeek(schedule.endAt) : undefined,
    };

    setDuplicateValues(values);
    setIsDuplicateDialogOpen(true);
  };

  const statusMeta = getStatusMeta(schedule.status);
  const StatusIcon = statusMeta.icon;
  const statusLabel = statusMeta.label;
  const statusStyle = statusMeta.colorTokens.badge;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="space-y-4">
            {/* 상태 및 공개 설정 배지 */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                className={cn(
                  "text-xs px-2.5 py-1 border-0 font-semibold inline-flex items-center gap-1",
                  statusStyle
                )}
              >
                <StatusIcon className="size-3" aria-hidden="true" />
                <span>{statusLabel}</span>
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs px-2.5 py-1 font-medium",
                  schedule.visibility === "PUBLIC"
                    ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800"
                    : "bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800/50 dark:text-gray-300 dark:border-gray-700"
                )}
              >
                {schedule.visibility === "PUBLIC" ? (
                  <>
                    <Eye className="size-3 mr-1" />
                    공개
                  </>
                ) : (
                  <>
                    <EyeOff className="size-3 mr-1" />
                    비공개
                  </>
                )}
              </Badge>
              {schedule.isCanceled && (
                <Badge
                  variant="destructive"
                  className="text-xs px-2.5 py-1 font-medium"
                >
                  취소됨
                </Badge>
              )}
            </div>

            {/* 제목 */}
            <DialogTitle className="text-2xl font-bold leading-tight pr-8">
              {schedule.title}
            </DialogTitle>
          </DialogHeader>

          <Separator />

          <div className="space-y-5 py-2">
            {/* 날짜/시간 - 강조된 박스 */}
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                {schedule.allDay ? (
                  <div className="rounded-full bg-primary/10 p-2">
                    <Calendar className="size-5 text-primary" />
                  </div>
                ) : (
                  <div className="rounded-full bg-primary/10 p-2">
                    <Clock className="size-5 text-primary" />
                  </div>
                )}
                <div className="flex-1">
                  <div className="text-sm font-semibold text-foreground mb-1">
                    {schedule.allDay ? "하루 종일" : "일정"}
                  </div>
                  <div className="text-sm text-foreground font-medium">
                    {schedule.allDay ? (
                      <>
                        {formatDate(schedule.startAt)}
                        {schedule.endAt &&
                          schedule.endAt !== schedule.startAt &&
                          ` - ${formatDate(schedule.endAt)}`}
                      </>
                    ) : (
                      <>
                        {formatDateTime(schedule.startAt)}
                        {schedule.endAt && (
                          <>
                            <br />
                            <span className="text-muted-foreground">
                              ~
                            </span>{" "}
                            {formatDateTime(schedule.endAt)}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 설명 */}
            {schedule.content && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">
                  설명
                </div>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/20 rounded-lg p-3 border">
                  {schedule.content}
                </div>
              </div>
            )}

            {/* 장소 */}
            {schedule.location && (
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                <div className="rounded-full bg-orange-100 dark:bg-orange-900/30 p-2">
                  <MapPin className="size-4 text-orange-600 dark:text-orange-400" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-medium text-muted-foreground mb-0.5">
                    장소
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    {schedule.location}
                  </div>
                </div>
              </div>
            )}

            {/* 외부 링크 */}
            {schedule.externalUrl && (
              <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                <div className="rounded-full bg-blue-100 dark:bg-blue-900/30 p-2">
                  <ExternalLink className="size-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-muted-foreground mb-0.5">
                    외부 링크
                  </div>
                  <a
                    href={schedule.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline break-all"
                  >
                    {schedule.externalUrl}
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* 등록/수정 일시 */}
          {schedule.updatedAt !== schedule.createdAt && (
            <>
              <Separator />
              <div className="text-xs text-muted-foreground">
                마지막 수정:{" "}
                {new Date(schedule.updatedAt).toLocaleString("ko-KR")}
              </div>
            </>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
            {canEdit && (
              <Button
                variant="outline"
                className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => setIsDeleteDialogOpen(true)}
                disabled={deleteMutation.isPending}
              >
                삭제하기
              </Button>
            )}
            <div className="flex gap-2 flex-1 sm:flex-initial">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 sm:flex-initial"
              >
                닫기
              </Button>
              {canEdit && (
                <Button
                  variant="outline"
                  onClick={handleDuplicate}
                  className="flex-1 sm:flex-initial"
                >
                  복제
                </Button>
              )}
              {canEdit && (
                <Button
                  onClick={() => setIsEditDialogOpen(true)}
                  className="flex-1 sm:flex-initial"
                >
                  수정하기
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 수정 다이얼로그 */}
      <ScheduleFormDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        channelId={channelId}
        schedule={schedule}
        onSuccess={() => {
          handleEditSuccess();
          onOpenChange(false);
        }}
      />

      {/* 복제 다이얼로그 (생성 모드, 원본 값으로 prefill) */}
      {duplicateValues && (
        <ScheduleFormDialog
          open={isDuplicateDialogOpen}
          onOpenChange={setIsDuplicateDialogOpen}
          channelId={channelId}
          initialValues={duplicateValues}
          onSuccess={() => {
            onSuccess?.();
            onOpenChange(false);
          }}
        />
      )}

      {/* 삭제 확인 다이얼로그 */}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>일정을 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              이 작업은 되돌릴 수 없습니다. 정말로 이 일정을 삭제하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "삭제 중..." : "삭제"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
