"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  createDefaultImageSlot,
  createDefaultTextSlot,
} from "../../editor/default-slots";
import type { TemplateSlot } from "@/meloming/domains/schedule-template/types/template-spec";
import type { ToolId } from "./tool-types";

/**
 * 활성 도구에 따라 캔버스 빈 영역 클릭을 처리한다.
 *
 *  - Type        : 클릭한 좌표에 텍스트 슬롯 추가 (전경색 적용)
 *  - Image       : 200×200 이미지 슬롯 추가
 *  - Rectangle   : 100×100 사각형(이미지 fit=fill) 슬롯 추가
 *  - Eyedropper  : baseImage 의 해당 픽셀 색상을 추출 → setForegroundColor
 *  - Move/Marquee/Hand/Zoom : null 반환 (기본 동작 = deselect/marquee)
 *
 * 좌표는 design-space px (이미 zoom 보정됨).
 *
 * Eyedropper 는 baseImage URL 을 offscreen canvas 로 한 번만 로드해 cache.
 * 같은 URL 이면 재사용 — 매 클릭마다 fetch 하지 않는다.
 */
interface UseToolCanvasClickOptions {
  activeTool: ToolId;
  baseImageUrl: string;
  baseImageW: number;
  baseImageH: number;
  foregroundColor: string;
  setForegroundColor: (color: string) => void;
  addSlot: (slot: TemplateSlot, label: string) => void;
}

export function useToolCanvasClick({
  activeTool,
  baseImageUrl,
  baseImageW,
  baseImageH,
  foregroundColor,
  setForegroundColor,
  addSlot,
}: UseToolCanvasClickOptions) {
  // Eyedropper 용 offscreen canvas. baseImage URL 별로 캐시.
  const eyedropperCacheRef = useRef<{
    url: string;
    canvas: HTMLCanvasElement | null;
    promise: Promise<HTMLCanvasElement | null> | null;
  }>({ url: "", canvas: null, promise: null });

  // baseImage 가 변경되면 cache 무효화.
  useEffect(() => {
    if (eyedropperCacheRef.current.url !== baseImageUrl) {
      eyedropperCacheRef.current = { url: baseImageUrl, canvas: null, promise: null };
    }
  }, [baseImageUrl]);

  const ensureEyedropperCanvas = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const cache = eyedropperCacheRef.current;
    if (cache.canvas) return cache.canvas;
    if (cache.promise) return cache.promise;

    const promise = (async (): Promise<HTMLCanvasElement | null> => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("이미지 로드 실패"));
        });
        img.src = baseImageUrl;
        await loaded;
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const g = canvas.getContext("2d");
        if (!g) return null;
        g.drawImage(img, 0, 0);
        cache.canvas = canvas;
        return canvas;
      } catch {
        return null;
      } finally {
        cache.promise = null;
      }
    })();

    cache.promise = promise;
    return promise;
  }, [baseImageUrl]);

  const sampleColor = useCallback(
    async (designX: number, designY: number) => {
      const canvas = await ensureEyedropperCanvas();
      if (!canvas) return;
      const g = canvas.getContext("2d");
      if (!g) return;
      // baseImage 자연 좌표 = design-space (캔버스가 baseImage 와 1:1)
      const sx = Math.max(0, Math.min(canvas.width - 1, Math.round(designX)));
      const sy = Math.max(0, Math.min(canvas.height - 1, Math.round(designY)));
      try {
        const data = g.getImageData(sx, sy, 1, 1).data;
        const hex = `#${[data[0], data[1], data[2]]
          .map((c) => c.toString(16).padStart(2, "0"))
          .join("")}`;
        setForegroundColor(hex);
      } catch {
        // CORS 차단 시 readPixels 실패 — 무시
      }
    },
    [ensureEyedropperCanvas, setForegroundColor],
  );

  /**
   * ScheduleTemplateEditorCanvas.onBackgroundClick 콜백.
   * 도구가 캔버스 클릭을 핸들했으면 true (deselect 우회), 아니면 false.
   */
  const handleBackgroundClick = useCallback(
    (designX: number, designY: number): boolean => {
      const x = Math.max(0, Math.round(designX));
      const y = Math.max(0, Math.round(designY));

      switch (activeTool) {
        case "type": {
          const slot = createDefaultTextSlot();
          slot.x = Math.min(x, baseImageW - slot.w);
          slot.y = Math.min(y, baseImageH - slot.h);
          slot.font.color = foregroundColor;
          addSlot(slot, "텍스트 추가 (캔버스 클릭)");
          return true;
        }
        case "image": {
          const slot = createDefaultImageSlot();
          slot.x = Math.min(x, baseImageW - slot.w);
          slot.y = Math.min(y, baseImageH - slot.h);
          addSlot(slot, "이미지 추가 (캔버스 클릭)");
          return true;
        }
        case "rectangle": {
          const slot = createDefaultImageSlot();
          slot.w = 100;
          slot.h = 100;
          slot.fit = "fill";
          slot.x = Math.min(x, baseImageW - slot.w);
          slot.y = Math.min(y, baseImageH - slot.h);
          addSlot(slot, "사각형 추가 (캔버스 클릭)");
          return true;
        }
        case "eyedropper": {
          // 비동기 — 결과는 setForegroundColor 로 dispatch.
          void sampleColor(x, y);
          return true;
        }
        // 그 외 도구는 기본 deselect/marquee 흐름.
        default:
          return false;
      }
    },
    [activeTool, baseImageW, baseImageH, foregroundColor, addSlot, sampleColor],
  );

  return { handleBackgroundClick };
}
