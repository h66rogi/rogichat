"use client";

import { useMemo, useState } from "react";
import { Settings, AlertCircle } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import type { TotalOverlayWidgetId } from "@/meloming/domains/overlay/constants/total-layout";

const VIRTUAL_WIDTH = 1920;
const VIRTUAL_HEIGHT = 1080;

interface CanvasIframePreviewProps {
  overlayToken: string | null;
  widgetId: TotalOverlayWidgetId;
  overlayPath?: string;
  canvasWidth: number;
  widgetW: number;
  widgetH: number;
  selected: boolean;
  settingsAvailable: boolean;
  previewEnabled?: boolean;
  onSettingsClick?: () => void;
  label: string;
}

export function CanvasIframePreview({
  overlayToken,
  widgetId,
  overlayPath = "overlay",
  canvasWidth,
  widgetW,
  widgetH,
  selected,
  settingsAvailable,
  previewEnabled = true,
  onSettingsClick,
  label,
}: CanvasIframePreviewProps) {
  const overlayBaseUrl = process.env.NEXT_PUBLIC_OVERLAY_BASE_URL;
  const [loaded, setLoaded] = useState(false);

  const iframeUrl = useMemo(() => {
    if (!overlayToken) return null;
    if (!previewEnabled) return null;
    if (!settingsAvailable) return null;
    const baseUrl =
      overlayBaseUrl ||
      (typeof window !== "undefined" ? window.location.origin : "");
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
    if (overlayPath === "sync-overlay") {
      return `${normalizedBaseUrl}/${overlayPath}/${overlayToken}/widgets/total?preview=1&previewWidget=${widgetId}`;
    }
    return `${normalizedBaseUrl}/${overlayPath}/${overlayToken}/widgets/${widgetId}?preview=1`;
  }, [overlayBaseUrl, overlayToken, overlayPath, widgetId, settingsAvailable, previewEnabled]);

  const nativeWidth = VIRTUAL_WIDTH * widgetW;
  const nativeHeight = VIRTUAL_HEIGHT * widgetH;
  const scale = canvasWidth > 0 ? canvasWidth / VIRTUAL_WIDTH : 1;

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-md border transition-colors",
        selected
          ? "border-foreground/60 bg-background/40 ring-2 ring-foreground/25"
          : "border-foreground/20 bg-background/30",
      )}
    >
      {iframeUrl ? (
        <>
          <iframe
            src={iframeUrl}
            title={`${label} 미리보기`}
            onLoad={() => setLoaded(true)}
            style={{
              width: `${nativeWidth}px`,
              height: `${nativeHeight}px`,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              border: 0,
              pointerEvents: "none",
              background: "transparent",
            }}
          />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground pointer-events-none">
              로딩 중...
            </div>
          )}
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-foreground/70 pointer-events-none">
          {settingsAvailable ? (
            <span>{label}</span>
          ) : (
            <div className="flex items-center gap-1.5">
              <AlertCircle className="size-3" />
              <span>{label} (준비중)</span>
            </div>
          )}
        </div>
      )}

      {settingsAvailable && onSettingsClick && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSettingsClick();
          }}
          className="absolute top-1 right-1 z-10 inline-flex size-7 items-center justify-center rounded-md border bg-background/90 text-foreground/70 shadow-sm transition-colors hover:bg-background hover:text-foreground"
          aria-label={`${label} 설정 열기`}
        >
          <Settings className="size-3.5" />
        </button>
      )}
    </div>
  );
}
