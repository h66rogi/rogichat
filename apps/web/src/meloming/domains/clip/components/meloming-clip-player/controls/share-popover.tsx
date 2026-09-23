"use client";

import { useEffect, useRef } from "react";
import { Link2, Code2 } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";

interface SharePopoverProps {
  visible: boolean;
  onClose(): void;
  onCopyLink(): void | Promise<void>;
  /** 라이브 모드 등 임베드 코드가 의미 없는 컨텍스트에서는 omit — 임베드 복사 버튼이 숨겨진다. */
  onCopyEmbed?: () => void | Promise<void>;
}

/**
 * 영상 영역 내부에 absolute 로 떠 있는 작은 공유 메뉴.
 * 링크 복사 / 임베드 복사 두 옵션만 — Dialog/ShareSheet 미사용.
 */
export function SharePopover({
  visible,
  onClose,
  onCopyLink,
  onCopyEmbed,
}: SharePopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!visible) return;
    captureIntentEvent("clip_player_share_popover_viewed", {
      funnel: "clip_sharing",
      has_embed_option: Boolean(onCopyEmbed),
    });
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="공유"
      className={cn(
        "absolute right-4 top-16 z-40 min-w-[160px] overflow-hidden rounded-md border border-white/10 bg-black/90 text-white shadow-xl backdrop-blur-md"
      )}
    >
      <button
        type="button"
        role="menuitem"
        onClick={async () => {
          captureIntentEvent("clip_player_share_link_copy_clicked", {
            funnel: "clip_sharing",
            source: "player_share_popover",
          });
          await onCopyLink();
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/10 focus:bg-white/10 focus:outline-none"
      >
        <Link2 className="size-4" />
        링크 복사
      </button>
      {onCopyEmbed && (
        <button
          type="button"
          role="menuitem"
          onClick={async () => {
            captureIntentEvent("clip_player_share_embed_copy_clicked", {
              funnel: "clip_sharing",
              source: "player_share_popover",
            });
            await onCopyEmbed();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/10 focus:bg-white/10 focus:outline-none"
        >
          <Code2 className="size-4" />
          임베드 복사
        </button>
      )}
    </div>
  );
}
