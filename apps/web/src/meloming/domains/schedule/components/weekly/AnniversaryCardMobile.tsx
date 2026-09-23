import type { CalendarAnniversary } from "@/meloming/domains/schedule/types/anniversary";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/meloming/shared/components/ui/avatar";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Cake, PartyPopper } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import { useRouter } from "next/navigation";

type AnniversaryCardMobileProps = {
  anniversary: CalendarAnniversary;
};

function getAnniversaryColor(type: "broadcast" | "birthday"): {
  bg: string;
  border: string;
  badge: string;
  icon: string;
} {
  if (type === "birthday") {
    return {
      bg: "bg-gradient-to-r from-pink-50 to-rose-50 dark:from-pink-950/30 dark:to-rose-950/30",
      border: "border-l-pink-500",
      badge: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300",
      icon: "text-pink-500 dark:text-pink-400",
    };
  }
  // broadcast (milestone)
  return {
    bg: "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30",
    border: "border-l-amber-500",
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    icon: "text-amber-500 dark:text-amber-400",
  };
}

export function AnniversaryCardMobile({
  anniversary,
}: AnniversaryCardMobileProps) {
  const router = useRouter();
  const colors = getAnniversaryColor(anniversary.type);
  const Icon = anniversary.type === "birthday" ? Cake : PartyPopper;
  const isDDay = anniversary.daysUntil === 0;

  const handleClick = () => {
    router.push(`/channel/${anniversary.webPath}`);
  };

  return (
    <div
      className={cn(
        "border-l-4 rounded-md p-3 active:scale-[0.98] transition-transform cursor-pointer",
        colors.bg,
        colors.border
      )}
      onClick={handleClick}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 mt-0.5">
          <Avatar className="size-8">
            <AvatarImage src={anniversary.profileImageUrl ?? undefined} />
            <AvatarFallback
              style={{
                backgroundColor: anniversary.themeColor ?? "#6366f1",
              }}
              className="text-white text-xs"
            >
              {anniversary.channelName.charAt(0)}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <div className="flex items-center gap-1">
              <Icon className={cn("size-3", colors.icon)} />
              <span
                className={cn(
                  "text-xs font-bold",
                  isDDay ? "text-red-600 dark:text-red-400" : "text-foreground"
                )}
              >
                {isDDay ? "D-DAY" : `D-${anniversary.daysUntil}`}
              </span>
            </div>
            <Badge
              className={cn("text-[10px] px-1.5 py-0 h-5 border-0", colors.badge)}
            >
              {anniversary.type === "birthday" ? "생일" : "기념일"}
            </Badge>
          </div>
          <p className="text-sm font-semibold mb-1 line-clamp-2 leading-snug">
            {anniversary.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {anniversary.channelName}
          </p>
        </div>
      </div>
    </div>
  );
}

