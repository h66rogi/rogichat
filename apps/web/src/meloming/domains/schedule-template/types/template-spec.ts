/**
 * Schedule 이미지 Template Spec.
 *
 * ScheduleTemplate.templateSpec (백엔드 Prisma Json 컬럼) 에 저장되는 구조.
 * baseImageUrl 위에 슬롯을 덧그려 주간 시간표 이미지를 생성한다.
 *
 * 백엔드 정합: meloming-back `src/schedule-renders/types/template-spec.type.ts`
 *
 * - 버전: 1 — V2 필드들은 모두 optional 로 추가되어 backward compat 유지.
 *   서버 렌더러(@napi-rs/canvas) 와 클라이언트 미리보기 모두 V2 필드를 인식.
 * - 좌표계: 좌상단 (0,0) 기준, px. baseImageW / baseImageH 안에서 정의됨
 * - binding DSL 로 동적 데이터(`channel.*`, `week.*`, `day[N].*`) 참조
 */
export interface TemplateSpecV1 {
  version: 1;
  slots: TemplateSlot[];
}

export type TemplateSlot = TextSlot | ImageSlot;

/**
 * Photoshop 표준 블렌드 모드.
 *
 * canvas-renderer 가 `globalCompositeOperation` 으로 매핑한다.
 * `normal` 은 default — globalCompositeOperation="source-over".
 */
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: "Normal",
  multiply: "Multiply",
  screen: "Screen",
  overlay: "Overlay",
  darken: "Darken",
  lighten: "Lighten",
  "color-dodge": "Color Dodge",
  "color-burn": "Color Burn",
  "hard-light": "Hard Light",
  "soft-light": "Soft Light",
  difference: "Difference",
  exclusion: "Exclusion",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
};

/**
 * 모든 슬롯 공통 레이아웃.
 */
export interface SlotBase {
  /**
   * 슬롯 식별자. 디버깅/로깅용. 일반적으로 사람이 알아볼 수 있는 이름
   * (예: `day0.title`, `channel.profile`) 사용을 권장.
   */
  id: string;
  /** 사용자가 지정한 레이어 이름 (Photoshop 레이어 패널 표시용). 없으면 describeSlot 폴백. */
  name?: string;
  /** px, 좌상단 기준 */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 회전각(도). MVP 는 0 만 정식 지원. 0 이 아닌 값이 들어올 경우 렌더러는
   * best-effort 로 회전을 적용한다.
   */
  rotation?: number;
  /**
   * 잠금 상태.
   * 잠긴 슬롯은 캔버스에서 드래그/리사이즈/회전을 비활성화하고 마키 선택에서 제외된다.
   * 단, 클릭으로 단일 선택은 가능 (사용자가 잠금을 해제할 수 있도록).
   * 백엔드 렌더에는 영향 없음 — 잠금은 순수 에디터 UX 정책.
   */
  locked?: boolean;
  /**
   * 위치만 잠금 (Photoshop 패리티). drag 비활성, resize 는 가능.
   * locked 가 true 면 lockPosition 값과 무관하게 전체 잠금.
   */
  lockPosition?: boolean;
  /**
   * 숨김 상태.
   * 캔버스 + 미리보기 + PNG 출력에서 모두 제외된다. 레이어 패널에서는 italic 으로
   * 표시되어 사용자가 다시 표시할 수 있다.
   */
  hidden?: boolean;
  /**
   * 그룹 식별자.
   * 같은 groupId 를 가진 슬롯들은 한 슬롯을 선택하면 모두 함께 선택되고,
   * 한 슬롯을 드래그하면 같은 delta 로 함께 이동한다.
   * 백엔드 렌더에는 영향 없음.
   */
  groupId?: string;
  /** 그룹 표시 이름 (Photoshop 폴더 라벨). 미지정 시 "그룹". */
  groupName?: string;
  /**
   * 슬롯 불투명도 (0–1). default 1.
   * 서버 렌더러에서 globalAlpha 로 적용된다.
   */
  opacity?: number;
  /**
   * Photoshop 블렌드 모드. default "normal".
   * 서버 렌더러에서 globalCompositeOperation 으로 매핑.
   */
  blendMode?: BlendMode;
}

export interface TextSlot extends SlotBase {
  type: "text";
  /**
   * 동적 바인딩 DSL. (예: `channel.name`, `day[0].title`).
   * resolve 결과가 null 이면 literal 사용.
   */
  binding?: string;
  /** binding 이 null 이거나 binding 이 없는 경우 사용되는 고정 텍스트 */
  literal?: string;
  font: TextSlotFont;
}

export interface TextSlotFont {
  /** MVP 는 Pretendard 단일. 확장 시 enum 화 예정 */
  family: "Pretendard";
  weight: 400 | 500 | 600 | 700 | 800;
  /** px */
  size: number;
  /** `#RRGGBB` 또는 `rgba(...)` */
  color: string;
  align: "left" | "center" | "right";
  /** 줄 간격 배수. default 1.2 */
  lineHeight?: number;
  /** 최대 줄 수. 넘치면 마지막 줄 말미에 ellipsis(...) */
  maxLines?: number;
  /** 자간 (px). default 0. canvas 측 letterSpacing 으로 매핑. */
  letterSpacing?: number;
  /** 세로 배율 (1 = 정상, 1.2 = 20% 더 길쭉). canvas transform 으로 적용. */
  verticalScale?: number;
  /** 텍스트 장식. default "none". */
  decoration?: "none" | "underline" | "line-through";
  /** italic 여부 (font-style). default false. */
  italic?: boolean;
}

export interface ImageSlot extends SlotBase {
  type: "image";
  /**
   * 동적 바인딩 (예: `day[0].thumbnail`, `channel.profileImageUrl`).
   * resolve 결과가 null 이면 fallbackUrl 사용. 둘 다 없으면 렌더 스킵.
   */
  binding?: string;
  fallbackUrl?: string;
  /**
   * 슬롯 박스(w,h) 내부에 이미지를 어떻게 맞출지:
   *  - cover: 가로/세로 비율 유지하며 박스를 꽉 채움 (over 는 크롭)
   *  - contain: 비율 유지하며 박스 안에 전부 보이게 (여백 남음)
   *  - fill: 비율 무시하고 박스 크기에 강제로 stretch
   */
  fit: "cover" | "contain" | "fill";
  /**
   * 둥근 모서리 px. 지정 시 해당 반경으로 clip 후 그린다.
   */
  borderRadius?: number;
}
