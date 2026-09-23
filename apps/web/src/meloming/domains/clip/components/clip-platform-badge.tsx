import { cn } from "@/meloming/shared/lib/utils";
import type { ClipPlatform } from "@/meloming/domains/clip/types/clip";
import { Youtube, Globe } from "lucide-react";

interface ClipPlatformBadgeProps {
  platform: ClipPlatform;
  className?: string;
  size?: "default" | "sm";
}

const platformConfig: Record<ClipPlatform, {
  bgClass: string;
  iconClass: string;
  label: string;
}> = {
  YOUTUBE: {
    bgClass: "bg-red-600",
    iconClass: "text-white",
    label: "YouTube",
  },
  SOOP: {
    bgClass: "bg-[#0066FF]",
    iconClass: "text-white",
    label: "SOOP",
  },
  CHZZK: {
    bgClass: "bg-[#00FFA3]",
    iconClass: "text-black",
    label: "치지직",
  },
  MELOMING: {
    bgClass: "bg-indigo-500",
    iconClass: "text-white",
    label: "Meloming Clip",
  },
};

export function ClipPlatformBadge({
  platform,
  className,
  size = "default",
}: ClipPlatformBadgeProps) {
  const config = platformConfig[platform] ?? platformConfig.MELOMING;
  const containerSize = size === "sm" ? "size-5" : "size-6";
  const iconSize = size === "sm" ? "size-3" : "size-3.5";

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center overflow-hidden",
        containerSize,
        config.bgClass,
        className
      )}
      title={config.label}
    >
      {platform === "YOUTUBE" && (
        <Youtube className={cn(iconSize, config.iconClass)} />
      )}
      {platform === "SOOP" && (
        <img
          src="/static/soop-square.png"
          alt="SOOP"
          className={cn(iconSize, "rounded-sm")}
        />
      )}
      {platform === "CHZZK" && (
        <img
          src="/static/chzzk-square.png"
          alt="치지직"
          className={cn(iconSize, "rounded-sm")}
        />
      )}
      {platform === "MELOMING" && (
        <img
          src="/logo/meloming-logo-512.png"
          alt="Meloming Clip"
          className={cn(iconSize, "object-contain")}
        />
      )}
      {!["YOUTUBE", "SOOP", "CHZZK", "MELOMING"].includes(platform) && (
        <Globe className={cn(iconSize, config.iconClass)} />
      )}
    </div>
  );
}
