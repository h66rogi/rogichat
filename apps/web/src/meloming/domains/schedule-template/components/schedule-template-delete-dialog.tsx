"use client";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { useDeleteScheduleTemplate } from "@/meloming/domains/schedule-template/hooks";
import type { ScheduleTemplate } from "@/meloming/domains/schedule-template/types";

interface ScheduleTemplateDeleteDialogProps {
  template: ScheduleTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 시간표 템플릿 삭제 confirm 다이얼로그.
 *
 * 서버는 soft delete — 취소는 어드민 조치 필요 . 안내 문구로 경고.
 * 성공 시 list invalidate 는 훅 내부에서 처리.
 */
export function ScheduleTemplateDeleteDialog({
  template,
  open,
  onOpenChange,
}: ScheduleTemplateDeleteDialogProps) {
  const deleteMutation = useDeleteScheduleTemplate();
  const isPending = deleteMutation.isPending;

  const handleDelete = async () => {
    if (!template) return;
    try {
      await deleteMutation.mutateAsync({
        id: template.id,
        channelId: template.channelId,
      });
      toast.success("템플릿을 삭제했어요.");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        extractApiErrorMessage(
          error,
          "템플릿 삭제에 실패했어요. 잠시 후 다시 시도해 주세요.",
        ),
      );
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>템플릿을 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            {template ? (
              <>
                <span className="font-medium text-foreground">
                  {template.name}
                </span>{" "}
                템플릿이 삭제됩니다. 이 템플릿으로 생성된 기존 시간표 이미지는
                유지되지만, 새로 렌더링할 수는 없어요.
              </>
            ) : (
              "선택한 템플릿이 삭제됩니다."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // AlertDialogAction 은 기본으로 닫힘 — 비동기 처리 위해 차단
              e.preventDefault();
              handleDelete();
            }}
            disabled={isPending}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                삭제 중…
              </>
            ) : (
              "삭제하기"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
