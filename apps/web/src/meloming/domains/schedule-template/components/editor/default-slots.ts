import type {
  BlendMode,
  ImageSlot,
  TemplateSlot,
  TemplateSpecV1,
  TextSlot,
} from "@/meloming/domains/schedule-template/types/template-spec";

/**
 * 에디터(F4)에서 사용하는 슬롯 기본값/유틸 모음.
 *
 * - 새 슬롯 생성 시 "깨지지 않는" 안전한 기본값을 제공 (크기/색상/정렬 등).
 * - 슬롯 `id` 는 충돌 회피와 디버그 가독성을 위해 `<type>-<epoch-ms>-<short>` 형식.
 *   templateSpec 은 Json 이고 서버가 구조 검증을 하지 않으므로 클라이언트에서
 *   유니크해야 한다 (목록/선택 키로도 쓰임).
 */

const VALID_BLEND_MODES = new Set<BlendMode>([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

function createSlotId(prefix: string): string {
  const short = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${short}`;
}

/**
 * 새 TextSlot 기본값 — 좌상단 근처, Pretendard 500 24px 검정, 좌측 정렬.
 * literal 로 `"텍스트"` 를 넣어 배치 직후에도 시각적으로 확인 가능.
 */
export function createDefaultTextSlot(): TextSlot {
  return {
    id: createSlotId("text"),
    type: "text",
    x: 50,
    y: 50,
    w: 200,
    h: 50,
    rotation: 0,
    opacity: 1,
    blendMode: "normal",
    binding: "",
    literal: "텍스트",
    font: {
      family: "Pretendard",
      weight: 500,
      size: 24,
      color: "#111111",
      align: "left",
      lineHeight: 1.2,
      maxLines: 1,
      letterSpacing: 0,
      verticalScale: 1,
      decoration: "none",
      italic: false,
    },
  };
}

/**
 * 새 ImageSlot 기본값 — cover, 0 radius, binding 비움.
 * fallbackUrl 없이 시작 → 저장 시 binding 또는 fallbackUrl 중 하나를
 * 요구하는 식으로 상위에서 안내.
 */
export function createDefaultImageSlot(): ImageSlot {
  return {
    id: createSlotId("image"),
    type: "image",
    x: 50,
    y: 50,
    w: 200,
    h: 200,
    rotation: 0,
    opacity: 1,
    blendMode: "normal",
    binding: "",
    fallbackUrl: "",
    fit: "cover",
    borderRadius: 0,
  };
}

/**
 * 빈 TemplateSpec v1 — 생성 직후 등에서 사용.
 */
export function createEmptyTemplateSpec(): TemplateSpecV1 {
  return { version: 1, slots: [] };
}

/**
 * `ScheduleTemplate.templateSpec` (unknown) 를 에디터용 V1 으로 변환.
 * 구조가 잘못되었으면 빈 스펙으로 복구 — 에디터가 초기 진입에서 깨지지 않게 한다.
 *
 * 잘못된 슬롯은 **drop 전략**: coerce(기본값 채워넣기) 하지 않고 조용히 제외한다.
 * 이유는 (1) 사용자가 알지 못한 채 데이터가 변조되는 것을 피하고,
 * (2) 이후 저장 시 최소한 현재 세션의 "정상 슬롯" 만 보존되도록 하기 위함.
 * 다음 로드에서도 같은 malformed 슬롯은 계속 drop 되어 에디터가 깨지지 않는다.
 */
export function coerceTemplateSpec(spec: unknown): TemplateSpecV1 {
  if (!isRecord(spec)) return createEmptyTemplateSpec();
  if (spec.version !== 1 || !Array.isArray(spec.slots)) {
    return createEmptyTemplateSpec();
  }
  const slots: TemplateSlot[] = [];
  for (const raw of spec.slots) {
    if (isValidTextSlot(raw)) {
      slots.push(raw);
      continue;
    }
    if (isValidImageSlot(raw)) {
      slots.push(raw);
      continue;
    }
    // 깊은 가드 미통과 → drop + warn (dev 콘솔에서만 노이즈)
    console.warn("[schedule-template] dropping malformed slot", raw);
  }
  return { version: 1, slots };
}

/** `Record<string, unknown>` 으로 narrowing — null / 배열은 제외. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `SlotBase` 공통 레이아웃 필드를 모두 검사. */
function hasValidSlotBase(v: Record<string, unknown>): boolean {
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.x !== "number" || !Number.isFinite(v.x)) return false;
  if (typeof v.y !== "number" || !Number.isFinite(v.y)) return false;
  if (typeof v.w !== "number" || !Number.isFinite(v.w)) return false;
  if (typeof v.h !== "number" || !Number.isFinite(v.h)) return false;
  if (v.rotation !== undefined) {
    if (typeof v.rotation !== "number" || !Number.isFinite(v.rotation)) {
      return false;
    }
  }
  if (v.locked !== undefined && typeof v.locked !== "boolean") return false;
  if (v.lockPosition !== undefined && typeof v.lockPosition !== "boolean") {
    return false;
  }
  if (v.hidden !== undefined && typeof v.hidden !== "boolean") return false;
  if (v.groupId !== undefined && typeof v.groupId !== "string") return false;
  if (v.groupName !== undefined && typeof v.groupName !== "string") return false;
  if (v.name !== undefined && typeof v.name !== "string") return false;
  if (v.opacity !== undefined) {
    if (typeof v.opacity !== "number" || !Number.isFinite(v.opacity)) {
      return false;
    }
    if (v.opacity < 0 || v.opacity > 1) return false;
  }
  if (v.blendMode !== undefined) {
    if (typeof v.blendMode !== "string") return false;
    if (!VALID_BLEND_MODES.has(v.blendMode as BlendMode)) return false;
  }
  return true;
}

/**
 * TextSlot 깊은 런타임 가드.
 * `font` 객체의 size/color/align 등 에디터/렌더러가 접근하는 필드를 모두 검증.
 * 필수 필드가 하나라도 누락/타입 불일치면 false — 호출 측에서 drop.
 */
function isValidTextSlot(value: unknown): value is TextSlot {
  if (!isRecord(value)) return false;
  if (value.type !== "text") return false;
  if (!hasValidSlotBase(value)) return false;

  if (value.binding !== undefined && typeof value.binding !== "string") {
    return false;
  }
  if (value.literal !== undefined && typeof value.literal !== "string") {
    return false;
  }

  if (!isRecord(value.font)) return false;
  const font = value.font;
  if (font.family !== "Pretendard") return false;
  if (
    typeof font.weight !== "number" ||
    ![400, 500, 600, 700, 800].includes(font.weight)
  ) {
    return false;
  }
  if (typeof font.size !== "number" || !Number.isFinite(font.size)) return false;
  if (typeof font.color !== "string" || font.color.length === 0) return false;
  if (font.align !== "left" && font.align !== "center" && font.align !== "right") {
    return false;
  }
  if (font.lineHeight !== undefined) {
    if (typeof font.lineHeight !== "number" || !Number.isFinite(font.lineHeight)) {
      return false;
    }
  }
  if (font.maxLines !== undefined) {
    if (typeof font.maxLines !== "number" || !Number.isFinite(font.maxLines)) {
      return false;
    }
  }
  if (font.letterSpacing !== undefined) {
    if (
      typeof font.letterSpacing !== "number" ||
      !Number.isFinite(font.letterSpacing)
    ) {
      return false;
    }
  }
  if (font.verticalScale !== undefined) {
    if (
      typeof font.verticalScale !== "number" ||
      !Number.isFinite(font.verticalScale) ||
      font.verticalScale <= 0
    ) {
      return false;
    }
  }
  if (font.decoration !== undefined) {
    if (
      font.decoration !== "none" &&
      font.decoration !== "underline" &&
      font.decoration !== "line-through"
    ) {
      return false;
    }
  }
  if (font.italic !== undefined && typeof font.italic !== "boolean") {
    return false;
  }
  return true;
}

/**
 * ImageSlot 깊은 런타임 가드.
 * `fit` enum / `borderRadius` / 필수 레이아웃 필드까지 모두 검증.
 */
function isValidImageSlot(value: unknown): value is ImageSlot {
  if (!isRecord(value)) return false;
  if (value.type !== "image") return false;
  if (!hasValidSlotBase(value)) return false;

  if (value.binding !== undefined && typeof value.binding !== "string") {
    return false;
  }
  if (value.fallbackUrl !== undefined && typeof value.fallbackUrl !== "string") {
    return false;
  }
  if (value.fit !== "cover" && value.fit !== "contain" && value.fit !== "fill") {
    return false;
  }
  if (value.borderRadius !== undefined) {
    if (
      typeof value.borderRadius !== "number" ||
      !Number.isFinite(value.borderRadius)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 슬롯 목록에서 특정 id 를 patch 로 갱신한 새 배열 반환.
 *
 * union narrowing 을 위해 `type` 이 일치할 때만 patch 를 적용한다.
 * 호출 측은 `updateSlot<TextSlot>(slots, id, { ... })` 처럼 제네릭으로
 * 타입을 좁힐 수 있다.
 */
export function updateSlotById<T extends TemplateSlot>(
  slots: TemplateSlot[],
  id: string,
  patch: Partial<T>,
): TemplateSlot[] {
  return slots.map((slot) => {
    if (slot.id !== id) return slot;
    // `patch` 는 T(=slot 의 구체 타입) 일부이므로 안전하게 spread.
    // union 을 그대로 spread 하면 TS 가 불가능한 조합을 추정하므로 같은 타입임을 보장한 뒤 캐스팅.
    return { ...slot, ...(patch as object) } as TemplateSlot;
  });
}

/**
 * 라벨(UI 표시용) — binding/literal/type 을 조합해 사람이 알아볼 수 있는 이름 생성.
 * 슬롯 id 는 내부용이라 사용자에게는 이쪽이 더 친숙하다.
 *
 * Photoshop 패리티: 사용자가 명시적으로 `name` 을 지정했으면 우선 사용.
 */
export function describeSlot(slot: TemplateSlot): string {
  if (slot.name && slot.name.trim().length > 0) {
    return slot.name;
  }
  if (slot.type === "text") {
    if (slot.binding) return `텍스트 · ${slot.binding}`;
    if (slot.literal) return `텍스트 · "${truncate(slot.literal, 18)}"`;
    return "텍스트";
  }
  if (slot.binding) return `이미지 · ${slot.binding}`;
  if (slot.fallbackUrl) return "이미지 · fallback";
  return "이미지";
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
