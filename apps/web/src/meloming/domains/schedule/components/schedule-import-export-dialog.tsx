import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Sparkles, Rocket, ImageIcon } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

interface ScheduleImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ScheduleExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScheduleImportDialog({
  open,
  onOpenChange,
}: ScheduleImportDialogProps) {
  const importOptions = [
    {
      icon: Sparkles,
      title: "AI로 한 번에 등록하기",
      description:
        "텍스트나 이미지를 업로드하면 AI가 자동으로 일정을 추출하여 등록합니다",
      color: "text-purple-600 dark:text-purple-400",
      bgColor: "bg-purple-100 dark:bg-purple-900/30",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>일정 가져오기</DialogTitle>
          <DialogDescription>
            다양한 방법으로 일정을 빠르게 등록할 수 있습니다
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {importOptions.map((option, index) => (
            <button
              key={index}
              disabled
              className={cn(
                "w-full text-left p-4 rounded-lg border-2 transition-all",
                "opacity-60 cursor-not-allowed"
              )}
            >
              <div className="flex items-start gap-4">
                <div className={cn("rounded-full p-3", option.bgColor)}>
                  <option.icon className={cn("size-6", option.color)} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-base mb-1">
                    {option.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {option.description}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs font-medium">
                      <Rocket className="size-3" />
                      출시 예정
                    </div>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ScheduleExportDialog({
  open,
  onOpenChange,
}: ScheduleExportDialogProps) {
  const exportOptions = [
    {
      icon: ImageIcon,
      title: "방송 일정표 이미지 만들기",
      description: "일정을 이미지 형식의 방송 일정표로 변환하여 다운로드합니다",
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-100 dark:bg-green-900/30",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>일정 내보내기</DialogTitle>
          <DialogDescription>
            일정을 다양한 형식으로 내보낼 수 있습니다
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {exportOptions.map((option, index) => (
            <button
              key={index}
              disabled
              className={cn(
                "w-full text-left p-4 rounded-lg border-2 transition-all",
                "opacity-60 cursor-not-allowed"
              )}
            >
              <div className="flex items-start gap-4">
                <div className={cn("rounded-full p-3", option.bgColor)}>
                  <option.icon className={cn("size-6", option.color)} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-base mb-1">
                    {option.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {option.description}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs font-medium">
                      <Rocket className="size-3" />
                      출시 예정
                    </div>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
