"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/meloming/shared/components/ui/dialog";
import {
  Music,
  Info,
} from "lucide-react";
import type { PublicLiveSessionSettings } from "@/meloming/domains/overlay/apis/public-session";

interface SongRequestGuideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings?: PublicLiveSessionSettings | null;
}

export function SongRequestGuideModal({
  open,
  onOpenChange,
  settings,
}: SongRequestGuideModalProps) {
  const maxQueueSize = settings?.maxQueueSize ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music className="size-5 text-fuchsia-500" />
            신청곡 신청 방법
          </DialogTitle>
          <DialogDescription>
            아래 방법으로 원하는 노래를 신청할 수 있어요
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="flex gap-3 p-3 rounded-lg bg-fuchsia-500/5 border border-fuchsia-500/10">
            <div className="size-8 rounded-full bg-fuchsia-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Music className="size-4 text-fuchsia-500" />
            </div>
            <div>
              <h4 className="font-semibold text-sm">노래책에서 신청</h4>
              <ol className="text-sm text-muted-foreground mt-1 space-y-1 list-decimal list-inside">
                <li>노래 목록에서 원하는 곡을 클릭하세요</li>
                <li>
                  노래 정보 하단의{" "}
                  <span className="font-medium text-foreground">신청</span>{" "}
                  버튼을 눌러주세요
                </li>
                <li>대기열에 추가되면 스트리머가 순서대로 불러드려요</li>
              </ol>
            </div>
          </div>

          {maxQueueSize > 0 && (
            <div className="flex gap-3 p-3 rounded-lg bg-muted/50 border border-border">
              <div className="size-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                <Info className="size-4 text-muted-foreground" />
              </div>
              <div>
                <h4 className="font-semibold text-sm">참고사항</h4>
                <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                  <li>• 대기열은 최대 {maxQueueSize}곡까지 가능해요</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
