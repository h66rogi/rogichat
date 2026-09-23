/**
 * Schedule 이미지 Template Spec.
 *
 * ScheduleTemplate.templateSpec (Prisma Json 컬럼) 에 저장되는 구조.
 * baseImageUrl 위에 슬롯을 덧그려 주간 시간표 이미지를 생성한다.
 *
 * - 버전: 1 — V2 필드 (opacity / blendMode / letterSpacing / verticalScale /
 *   decoration / italic / lockPosition / name / groupName) 는 모두 optional 로
 *   추가되어 backward compat 유지. 클라이언트와 서버 렌더러가 모두 인식.
 * - 좌표계: 좌상단 (0,0) 기준, px. baseImageW / baseImageH 안에서 정의됨
 * - binding DSL 로 동적 데이터(`channel.*`, `week.*`, `day[N].*`) 참조
 */
export interface TemplateSpecV1 {
  version: 1;
  slots: TemplateSlot[];
}

export type TemplateSlot = TextSlot | ImageSlot;

/**
 * Photoshop 표준 블렌드 모드. canvas-renderer 가 globalCompositeOperation 으로 매핑.
 */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/**
 * 모든 슬롯 공통 레이아웃.
 */
export interface SlotBase {
  id: string;
  /** 사용자 지정 레이어 이름 (Photoshop 레이어 패널 표시). 미지정 시 frontend describeSlot fallback. */
  name?: string;
  x: number; // px, 좌상단 기준
  y: number;
  w: number;
  h: number;
  rotation?: number;
  /** 잠금 (드래그/리사이즈 차단). 렌더에는 영향 없음. */
  locked?: boolean;
  /** 위치 잠금만 (Photoshop 패리티). drag 차단, resize 가능. */
  lockPosition?: boolean;
  hidden?: boolean;
  groupId?: string;
  /** 그룹 표시 이름. */
  groupName?: string;
  /** 슬롯 불투명도 (0–1). default 1. canvas-renderer 가 globalAlpha 로 적용. */
  opacity?: number;
  /** 블렌드 모드. default "normal". globalCompositeOperation 으로 매핑. */
  blendMode?: BlendMode;
}

export interface TextSlot extends SlotBase {
  type: 'text';
  binding?: string;
  literal?: string;
  font: TextSlotFont;
}

export interface TextSlotFont {
  family: 'Pretendard';
  weight: 400 | 500 | 600 | 700 | 800;
  size: number; // px
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight?: number;
  maxLines?: number;
  /** 자간 (px). default 0. */
  letterSpacing?: number;
  /** 세로 배율 (1=정상). canvas transform.scale(1, vScale) 로 적용. */
  verticalScale?: number;
  /** 텍스트 장식. default "none". */
  decoration?: 'none' | 'underline' | 'line-through';
  /** italic 여부. default false. */
  italic?: boolean;
}

export interface ImageSlot extends SlotBase {
  type: 'image';
  binding?: string;
  fallbackUrl?: string;
  fit: 'cover' | 'contain' | 'fill';
  borderRadius?: number;
}
