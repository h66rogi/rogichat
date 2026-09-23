"use client";

import { forwardRef } from "react";
import type {
  ImageSlot,
  TemplateSlot,
  TemplateSpecV1,
  TextSlot,
} from "@/meloming/domains/schedule-template/types/template-spec";
import {
  resolveBinding,
  type PreviewBindingContext,
} from "@/meloming/domains/schedule-template/utils/binding-resolver";

interface TemplateCanvasPreviewProps {
  /** 템플릿 메타. baseImageUrl + design-space (baseImageW × baseImageH). */
  baseImageUrl: string;
  baseImageW: number;
  baseImageH: number;
  /** 슬롯 정의 (TemplateSpecV1.slots). */
  slots: TemplateSpecV1["slots"];
  /** binding 컨텍스트 — channel/week/days. */
  bindingContext: PreviewBindingContext;
  /** 화면 표시 폭. 디자인 폭이 너무 크면 transform: scale 로 축소한다. */
  displayWidth?: number;
  /** html-to-image 가 캡처할 outer ref. */
  className?: string;
}

/**
 * 클라이언트 사이드 템플릿 미리보기 컴포넌트 (F9).
 *
 *  - 디자인 좌표계는 `baseImageW × baseImageH` (px). 슬롯 좌표/크기는 모두 이
 *    공간에서 정의되어 있다.
 *  - 세 개의 div 레이어로 분리한다 (Codex F9 review#2 — scale² 회귀 fix):
 *      ┌─ wrapper (data-testid=…wrapper): 레이아웃 박스. 폭/높이가
 *      │           `baseImageW * scale × baseImageH * scale`. transform 없음.
 *      │           부모 flexbox 등이 보는 "차지하는 공간" 이 정확히 축소된 크기.
 *      ├─ scaler: `width=baseImageW, height=baseImageH, transform: scale(scale)`.
 *      │           시각적으로 baseImage 자연 좌표 박스를 wrapper 안에 맞춰 축소.
 *      └─ canvas (data-testid=…canvas, ref): `width=baseImageW, height=baseImageH`,
 *                  transform 없음. html-to-image 가 이 노드를 캡처해 baseImage
 *                  해상도 그대로의 PNG 를 만든다.
 *    핵심: wrapper 에 폭/높이를 넣고, scaler 에만 transform 을 두며, canvas (ref)
 *    는 transform 이 없어야 한다. wrapper 에 폭과 transform 을 둘 다 두면
 *    scale² 만큼 시각적으로 축소되어 미리보기가 좁게 잘리는 회귀가 발생한다.
 *    canvas 에 transform 을 두면 html-to-image 가 cssText 를 그대로 복사해
 *    PNG 도 같이 축소된다.
 *  - 서버 렌더(@napi-rs/canvas) 와 1:1 픽셀 일치는 보장하지 않는다 — 사용자가
 *    슬롯 배치/바인딩을 빠르게 확인할 수 있는 시각적 근사치다.
 *  - 외부 도메인 이미지(`baseImageUrl`, `slot.fallbackUrl`)는 `crossOrigin
 *    ="anonymous"` 로 요청한다. CDN 이 적절한 CORS 헤더를 안 주면 html-to-image
 *    캡처 시 tainted canvas 로 실패하며, 호출 측이 폴백 토스트를 띄운다.
 *
 * Forward ref 는 inner "디자인 공간" div (data-testid=…canvas). html-to-image
 * 는 이 노드를 캡처하면 원본 baseImage 해상도의 PNG 가 나온다.
 */
export const TemplateCanvasPreview = forwardRef<
  HTMLDivElement,
  TemplateCanvasPreviewProps
>(function TemplateCanvasPreview(
  {
    baseImageUrl,
    baseImageW,
    baseImageH,
    slots,
    bindingContext,
    displayWidth,
    className,
  },
  ref,
) {
  // 표시 배율. displayWidth 미지정이거나 baseImageW 보다 크면 1 (확대 안 함).
  const scale =
    displayWidth && displayWidth > 0 && displayWidth < baseImageW
      ? displayWidth / baseImageW
      : 1;
  const scaledW = baseImageW * scale;
  const scaledH = baseImageH * scale;

  return (
    <div
      className={className}
      style={{
        // wrapper 는 시각적으로 차지하는 공간 — 부모 레이아웃이 보는 박스.
        // transform 은 절대 두지 말 것 (scaler 와 합쳐지면 scale² 회귀).
        width: scaledW,
        height: scaledH,
        // scaler 의 자연 baseImageW × baseImageH 박스가 wrapper 보다 클 수 있어
        // overflow:hidden 으로 시각적으로 잘라낸다 (transform 적용 전 layout 단계).
        overflow: "hidden",
      }}
      data-testid="template-canvas-preview-wrapper"
    >
      <div
        style={{
          // scaler — 자연 좌표계 박스를 wrapper 에 맞춰 시각적으로 축소.
          // transform 은 layout 에 영향을 주지 않으므로, 자식 canvas 의 computed
          // transform 은 'none' 으로 남는다 (html-to-image 가 cssText 복사해도
          // 캡처 PNG 는 자연 해상도 유지).
          width: baseImageW,
          height: baseImageH,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: "top left",
        }}
        data-testid="template-canvas-preview-scaler"
      >
        <div
          ref={ref}
          data-testid="template-canvas-preview-canvas"
          style={{
            // canvas — html-to-image 캡처 대상. 자연 디자인 좌표 그대로.
            // ⚠ 여기에 transform 을 두면 안 된다. cloneCSSStyle 이 cssText 를
            //    그대로 복사하므로, 캡처 PNG 의 SVG/canvas 안에서도 동일한 scale
            //    이 적용되어 콘텐츠가 좌상단 일부에만 그려진다.
            width: baseImageW,
            height: baseImageH,
            position: "relative",
            // 흰 배경 — baseImage 가 투명/PNG 인 경우 html-to-image PNG 결과의
            // 배경이 일관되도록.
            backgroundColor: "#ffffff",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={baseImageUrl}
            alt="베이스 이미지"
            width={baseImageW}
            height={baseImageH}
            crossOrigin="anonymous"
            draggable={false}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: baseImageW,
              height: baseImageH,
              display: "block",
              userSelect: "none",
              pointerEvents: "none",
            }}
          />
          {slots.map((slot) => {
            // Phase 2C: hidden 슬롯은 미리보기와 캡처 PNG 양쪽에서 제외.
            // 백엔드 canvas-renderer 와 일치 (hidden=true → skip).
            if (slot.hidden === true) return null;
            return (
              <SlotLayer
                key={slot.id}
                slot={slot}
                bindingContext={bindingContext}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});

interface SlotLayerProps {
  slot: TemplateSlot;
  bindingContext: PreviewBindingContext;
}

function SlotLayer({ slot, bindingContext }: SlotLayerProps) {
  if (slot.type === "text") {
    return <TextSlotLayer slot={slot} bindingContext={bindingContext} />;
  }
  return <ImageSlotLayer slot={slot} bindingContext={bindingContext} />;
}

function TextSlotLayer({ slot, bindingContext }: SlotLayerProps & { slot: TextSlot }) {
  const resolved = slot.binding
    ? resolveBinding(slot.binding, bindingContext)
    : null;
  const text = resolved ?? slot.literal ?? "";

  // rotation 이 0/undefined 가 아니면 transform 적용. 백엔드 canvas-renderer 가
  // 슬롯 중심을 pivot 으로 회전하므로, 미리보기 CSS 도 transform-origin: center
  // 로 동일하게 맞춘다 (top-left 로 두면 캡처 PNG 가 서버 렌더와 어긋난다).
  const rotation = slot.rotation;
  const isRotated = typeof rotation === "number" && rotation !== 0;
  const rotationCss = isRotated ? `rotate(${rotation}deg)` : undefined;

  // CSS justify-content 매핑 (text-align 은 줄 내부 정렬 — flex 정렬은 박스 내).
  const justifyContent =
    slot.font.align === "center"
      ? "center"
      : slot.font.align === "right"
        ? "flex-end"
        : "flex-start";

  return (
    <div
      data-testid={`slot-text-${slot.id}`}
      style={{
        position: "absolute",
        left: slot.x,
        top: slot.y,
        width: slot.w,
        height: slot.h,
        overflow: "hidden",
        transform: rotationCss,
        transformOrigin: "center",
        display: "flex",
        alignItems: "flex-start",
        justifyContent,
        fontFamily: slot.font.family + ", system-ui, sans-serif",
        fontWeight: slot.font.weight,
        fontSize: `${slot.font.size}px`,
        color: slot.font.color,
        textAlign: slot.font.align,
        lineHeight: slot.font.lineHeight ?? 1.2,
        whiteSpace: "pre-wrap", // 줄바꿈 문자 `\n` 보존
      }}
    >
      <span
        style={{
          display: "-webkit-box",
          WebkitLineClamp: slot.font.maxLines ?? 1,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
          width: "100%",
          textAlign: slot.font.align,
        }}
      >
        {text}
      </span>
    </div>
  );
}

function ImageSlotLayer({
  slot,
  bindingContext,
}: SlotLayerProps & { slot: ImageSlot }) {
  const resolved = slot.binding
    ? resolveBinding(slot.binding, bindingContext)
    : null;
  const url = resolved ?? slot.fallbackUrl ?? null;
  const radius = slot.borderRadius ?? 0;

  // 백엔드 canvas-renderer 와 동일하게 슬롯 중심 기준 회전.
  const rotation = slot.rotation;
  const isRotated = typeof rotation === "number" && rotation !== 0;
  const rotationCss = isRotated ? `rotate(${rotation}deg)` : undefined;

  const objectFit =
    slot.fit === "cover"
      ? "cover"
      : slot.fit === "contain"
        ? "contain"
        : "fill";

  // url 이 없으면 슬롯 자체를 렌더하지 않는다 (서버 렌더와 동일한 "skip" 정책).
  if (!url) {
    return null;
  }

  return (
    <div
      data-testid={`slot-image-${slot.id}`}
      style={{
        position: "absolute",
        left: slot.x,
        top: slot.y,
        width: slot.w,
        height: slot.h,
        overflow: "hidden",
        borderRadius: radius,
        transform: rotationCss,
        transformOrigin: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={slot.binding ?? "이미지 슬롯"}
        crossOrigin="anonymous"
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit,
          display: "block",
          userSelect: "none",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
