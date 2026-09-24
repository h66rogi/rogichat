import type { Schedule } from "@/meloming/domains/schedule/types/schedule";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/meloming/shared/components/ui/avatar";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Clock } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import { useRouter } from "next/navigation";
import { getStatusMeta } from "@/meloming/domains/schedule/utils/schedule-status";
import { AvatarPlaceholder } from "@/shared/ui/avatar-placeholder";

type ScheduleCardDesktopProps = {
  schedule: Schedule;
  onClick?: () => void;
  hideChannel?: boolean;
};

const formatTime = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

export function ScheduleCardDesktop({
  schedule,
  onClick,
  hideChannel = false,
}: ScheduleCardDesktopProps) {
  const router = useRouter();
  const meta = getStatusMeta(schedule.status);
  const StatusIcon = meta.icon;
  const colors = meta.colorTokens;

  const handleClick = (e: React.MouseEvent) => {
    // External URL이 있으면 새 창으로 열기
    if (schedule.externalUrl) {
      e.stopPropagation();
      window.open(schedule.externalUrl, "_blank", "noopener,noreferrer");
    }
    // 모달도 열기
    onClick?.();
  };

  const handleChannelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const channelPath = schedule.channel?.webPath ?? schedule.channelWebPath;
    router.push(`/channel/${channelPath}`);
  };

  return (
    <div
      id={`channel-schedule-item-${schedule.id}`}
      data-testid="schedule-card-desktop"
      data-status={schedule.status}
      className={cn(
        "border border-l-4 rounded-lg px-3 py-2.5 hover:shadow-md transition-all cursor-pointer group channel-schedule-item",
        colors.bg,
        colors.border,
        colors.stripBorder
      )}
      onClick={handleClick}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge
            data-testid="schedule-card-status-badge"
            className={cn(
              "text-xs px-2 py-0.5 border-0 font-semibold inline-flex items-center gap-1",
              colors.badge
            )}
          >
            <StatusIcon className="size-3" aria-hidden="true" />
            <span>{meta.label}</span>
          </Badge>
          <div className="flex items-center gap-1 text-sm font-semibold tabular-nums">
            <Clock className="size-3.5" />
            <span>
              {schedule.allDay ? "종일" : formatTime(schedule.startAt)}
            </span>
          </div>
        </div>
        <h4 className="text-sm font-bold line-clamp-2 leading-snug group-hover:text-primary transition-colors">
          {schedule.title}
        </h4>
        {schedule.content && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {schedule.content}
          </p>
        )}
        {!hideChannel && schedule.channel && (
          <div
            className="flex items-center gap-2 pt-1.5 border-t border-border/50 cursor-pointer hover:opacity-70 transition-opacity"
            onClick={handleChannelClick}
          >
            <div className="hidden xl:block">
              <Avatar className="size-6">
                <AvatarImage
                  src={schedule.channel.profileImageUrl ?? undefined}
                />
                <AvatarFallback>
                  <AvatarPlaceholder />
                </AvatarFallback>
              </Avatar>
            </div>
            <span className="text-xs text-muted-foreground font-medium truncate">
              {schedule.channel.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
