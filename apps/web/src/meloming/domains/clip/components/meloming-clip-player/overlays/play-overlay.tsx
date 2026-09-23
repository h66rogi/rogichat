"use client";

import { Play, RotateCcw } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";

interface PlayOverlayProps {
  visible: boolean;
  /** ended 상태에서 띄울 때 true — 아이콘이 replay 로 바뀜 */
  replay?: boolean;
  onPlay: () => void;
}

export function PlayOverlay({ visible, replay = false, onPlay }: PlayOverlayProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => {
        captureIntentEvent("clip_player_play_overlay_clicked", {
          funnel: "clip_consumption",
          replay,
        });
        onPlay();
      }}
      aria-label={replay ? "다시 재생" : "재생"}
      className={cn(
        "absolute inset-0 z-30 flex items-center justify-center bg-black/30",
        "motion-safe:transition-opacity motion-safe:duration-200"
      )}
    >
      <span className="flex size-20 items-center justify-center rounded-full bg-white/90 text-black shadow-xl">
        {replay ? (
          <RotateCcw className="size-8" />
        ) : (
          <Play className="size-9 translate-x-0.5 fill-current" />
        )}
      </span>
    </button>
  );
}
