import Link from "next/link";
import { ArrowRight, BellRing } from "lucide-react";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import { cn } from "@/meloming/shared/lib/utils";

type RequestManagementAlertType = "song" | "clip";

interface RequestManagementAlertProps {
  type: RequestManagementAlertType;
  pendingCount: number;
  manageHref: string;
  className?: string;
}

const ALERT_CONTENT: Record<
  RequestManagementAlertType,
  {
    title: string;
    description: string;
    buttonLabel: string;
  }
> = {
  song: {
    title: "노래 추가 요청이 있습니다",
    description: "요청 목록에서 수락 또는 거절을 진행해주세요.",
    buttonLabel: "노래 요청 관리하기",
  },
  clip: {
    title: "클립 추가 요청이 있습니다",
    description: "요청 목록에서 수락 또는 거절을 진행해주세요.",
    buttonLabel: "클립 요청 관리하기",
  },
};

export function RequestManagementAlert({
  type,
  pendingCount,
  manageHref,
  className,
}: RequestManagementAlertProps) {
  if (pendingCount <= 0) {
    return null;
  }

  const content = ALERT_CONTENT[type];

  return (
    <section
      className={cn(
        "rounded-lg border border-amber-300/70 bg-amber-50/80 p-4",
        "dark:border-amber-500/40 dark:bg-amber-500/10",
        className
      )}
      aria-label={content.title}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-amber-500/20 p-2 text-amber-700 dark:text-amber-300">
            <BellRing className="size-4" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              {content.title}
            </p>
            <p className="text-xs text-amber-800/90 dark:text-amber-200/90">
              {content.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-amber-400/70 bg-amber-100/70 text-amber-900 dark:border-amber-400/60 dark:bg-amber-500/15 dark:text-amber-100"
          >
            {pendingCount.toLocaleString()}건 대기
          </Badge>
          <Link href={manageHref}>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400/70 bg-white/70 text-amber-900 hover:bg-amber-100 dark:border-amber-400/60 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/20"
            >
              {content.buttonLabel}
              <ArrowRight className="ml-1 size-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
