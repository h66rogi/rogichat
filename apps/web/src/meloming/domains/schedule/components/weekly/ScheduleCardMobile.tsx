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

type ScheduleCardMobileProps = {
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

export function ScheduleCardMobile({
  schedule,
  onClick,
  hideChannel = false,
}: ScheduleCardMobileProps) {
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
      data-testid="schedule-card-mobile"
      data-status={schedule.status}
      className={cn(
        "border-l-4 rounded-md px-3.5 py-3 active:scale-[0.98] transition-transform cursor-pointer channel-schedule-item",
        colors.bg,
        colors.stripBorder
      )}
      onClick={handleClick}
    >
      <div className="flex items-start gap-2.5">
        {!hideChannel && schedule.channel && (
          <div
            className="flex-shrink-0 mt-0.5 cursor-pointer hover:opacity-70 transition-opacity"
            onClick={handleChannelClick}
          >
            <Avatar className="size-9">
              <AvatarImage src={schedule.channel.profileImageUrl ?? undefined} />
              <AvatarFallback>
                <AvatarPlaceholder />
              </AvatarFallback>
            </Avatar>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge
              data-testid="schedule-card-status-badge"
              className={cn(
                "text-[11px] px-1.5 py-0 h-5 border-0 font-semibold inline-flex items-center gap-1",
                colors.badge
              )}
            >
              <StatusIcon className="size-3" aria-hidden="true" />
              <span>{meta.label}</span>
            </Badge>
            <div className="flex items-center gap-1 text-xs font-semibold tabular-nums">
              <Clock className="size-3" />
              <span>
                {schedule.allDay ? "종일" : formatTime(schedule.startAt)}
              </span>
            </div>
          </div>
          <p className="text-base font-semibold mb-1 line-clamp-2 leading-snug">
            {schedule.title}
          </p>
          {schedule.content && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-1">
              {schedule.content}
            </p>
          )}
          {!hideChannel && schedule.channel && (
            <p
              className="text-xs text-muted-foreground cursor-pointer hover:opacity-70 transition-opacity inline-block"
              onClick={handleChannelClick}
            >
              {schedule.channel.name}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
