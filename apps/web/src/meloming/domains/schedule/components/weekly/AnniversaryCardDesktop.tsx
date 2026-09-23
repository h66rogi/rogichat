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

type AnniversaryCardDesktopProps = {
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
      bg: "bg-gradient-to-br from-pink-50 to-rose-50 dark:from-pink-950/30 dark:to-rose-950/30",
      border: "border-pink-200 dark:border-pink-800",
      badge: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300",
      icon: "text-pink-500 dark:text-pink-400",
    };
  }
  // broadcast (milestone)
  return {
    bg: "bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30",
    border: "border-amber-200 dark:border-amber-800",
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    icon: "text-amber-500 dark:text-amber-400",
  };
}

export function AnniversaryCardDesktop({
  anniversary,
}: AnniversaryCardDesktopProps) {
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
        "border rounded-lg p-3 hover:shadow-md transition-all cursor-pointer group",
        colors.bg,
        colors.border
      )}
      onClick={handleClick}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Icon className={cn("size-3.5", colors.icon)} />
            <span
              className={cn(
                "text-sm font-bold",
                isDDay ? "text-red-600 dark:text-red-400" : "text-foreground"
              )}
            >
              {isDDay ? "D-DAY" : `D-${anniversary.daysUntil}`}
            </span>
          </div>
          <Badge
            className={cn(
              "text-xs px-2 py-0.5 border-0 hidden xl:block",
              colors.badge
            )}
          >
            {anniversary.type === "birthday" ? "생일" : "기념일"}
          </Badge>
        </div>
        <h4 className="text-sm font-bold line-clamp-2 leading-snug group-hover:text-primary transition-colors">
          {anniversary.label}
        </h4>
        <div className="flex items-center gap-2 pt-1 border-t border-border/50">
          <div className="hidden xl:block">
            <Avatar className="size-6">
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
          <span className="text-xs text-muted-foreground font-medium truncate">
            {anniversary.channelName}
          </span>
        </div>
      </div>
    </div>
  );
}

