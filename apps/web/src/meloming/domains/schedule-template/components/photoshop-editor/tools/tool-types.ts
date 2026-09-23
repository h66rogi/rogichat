/**
 * Photoshop 도구 정의.
 *
 * 마스크/필터 같은 raster 전용 도구는 제외 — 우리 데이터 모델은 vector 슬롯이라
 * 의미가 없다. (사용자 요청: "마스크 필터같은건 빼도 되긴 하겠다")
 */

import {
  Crop,
  Hand,
  ImagePlus,
  type LucideIcon,
  MousePointer2,
  Pipette,
  Square,
  SquareDashed,
  Type as TypeIcon,
  ZoomIn,
} from "lucide-react";

export type ToolId =
  | "move"        // V — 슬롯 이동/선택 (기본)
  | "marquee"     // M — 사각형 마키 선택
  | "hand"        // H — 캔버스 pan
  | "zoom"        // Z — 캔버스 zoom in/out
  | "type"        // T — 텍스트 슬롯 추가 + 클릭으로 텍스트 편집
  | "rectangle"   // U — 사각형 도형 슬롯 (TextSlot literal="" + 배경)
  | "image"       // P — 이미지 슬롯 추가
  | "eyedropper"  // I — 캔버스에서 색상 추출 → 색상 패널로
  | "crop";       // C — 베이스 이미지 자르기 (구현 보류, 자리 차지)

export interface ToolDef {
  id: ToolId;
  label: string;
  shortcut: string;
  icon: LucideIcon;
  /** 캔버스 cursor CSS 값. */
  cursor: string;
  /** Phase 1 에서 미구현 도구는 disabled 표시. */
  disabled?: boolean;
}

export const TOOLS: ToolDef[] = [
  {
    id: "move",
    label: "이동",
    shortcut: "V",
    icon: MousePointer2,
    cursor: "default",
  },
  {
    id: "marquee",
    label: "사각 선택",
    shortcut: "M",
    icon: SquareDashed,
    cursor: "crosshair",
  },
  {
    id: "type",
    label: "문자",
    shortcut: "T",
    icon: TypeIcon,
    cursor: "text",
  },
  {
    id: "rectangle",
    label: "사각형",
    shortcut: "U",
    icon: Square,
    cursor: "crosshair",
  },
  {
    id: "image",
    label: "이미지",
    shortcut: "P",
    icon: ImagePlus,
    cursor: "crosshair",
  },
  {
    id: "eyedropper",
    label: "스포이드",
    shortcut: "I",
    icon: Pipette,
    cursor: "crosshair",
  },
  {
    id: "crop",
    label: "자르기",
    shortcut: "C",
    icon: Crop,
    cursor: "crosshair",
    disabled: true,
  },
  {
    id: "hand",
    label: "손",
    shortcut: "H",
    icon: Hand,
    cursor: "grab",
  },
  {
    id: "zoom",
    label: "돋보기",
    shortcut: "Z",
    icon: ZoomIn,
    cursor: "zoom-in",
  },
];

export const TOOL_BY_ID: Record<ToolId, ToolDef> = TOOLS.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<ToolId, ToolDef>,
);

export const TOOL_BY_SHORTCUT: Record<string, ToolId> = TOOLS.reduce(
  (acc, t) => {
    acc[t.shortcut.toLowerCase()] = t.id;
    return acc;
  },
  {} as Record<string, ToolId>,
);
