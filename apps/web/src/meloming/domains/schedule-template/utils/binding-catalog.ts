/**
 * 슬롯 binding 선택용 카탈로그.
 *
 * 백엔드 정합 — `meloming-back/src/schedule-renders/services/binding-resolver.service.ts`
 * 가 지원하는 모든 표현식을 사용자 친화 라벨로 변환해 dropdown 등에서 그대로 사용.
 *
 * - `BINDING_CATALOG`        : TextSlot 용 (모든 키 노출)
 * - `IMAGE_BINDING_CATALOG`  : ImageSlot 용 (URL/이미지 결과를 내는 키만)
 *
 * 새 binding 키가 백엔드에 추가될 때:
 *  1) `binding-resolver.ts` (클라이언트 미리보기 리졸버) 갱신
 *  2) 이 파일에 카탈로그 항목 추가
 *  3) `infer-binding-from-literal.ts` 의 휴리스틱 도메인 갱신 검토
 */

export type BindingGroup = "channel" | "week" | "day";

export interface BindingOption {
  /** 백엔드 DSL 표현 그대로 (예: `day[0].title`). */
  key: string;
  /** UI 표시용 한국어 라벨 (예: `월요일 — 방송 제목`). */
  label: string;
  /** dropdown 그룹 — channel / 주간 / 요일별. */
  group: BindingGroup;
  /** 요일 그룹의 day index (0..6). 비-day 그룹에서는 undefined. */
  dayIndex?: number;
}

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

function buildDayBindings(
  field: "title" | "startTime" | "status" | "thumbnail",
  labelSuffix: string,
): BindingOption[] {
  return DAY_LABELS.map((dayLabel, dayIndex) => ({
    key: `day[${dayIndex}].${field}`,
    label: `${dayLabel}요일 — ${labelSuffix}`,
    group: "day" as const,
    dayIndex,
  }));
}

/**
 * TextSlot 용 binding 카탈로그.
 *
 * 순서: channel(2) → week(3) → day(7×3 = 21) = 총 26개.
 * day group 은 "월~일 × {title, startTime, status}" 순으로 정의해
 * 사용자가 요일별 같은 필드를 묶어서 보지 않고 (요일 단위) 묶음을 보게 한다.
 *
 * 의도적으로 `day[N].thumbnail` 은 텍스트 카탈로그에서 제외했다 — 텍스트 슬롯에
 * URL 자체를 표시할 일이 없고, 사용자가 잘못 선택했을 때 결과가 매우 어색하기 때문.
 * (이미지 카탈로그에서만 노출.)
 */
export const BINDING_CATALOG: readonly BindingOption[] = [
  { key: "channel.name", label: "채널 이름", group: "channel" },
  {
    key: "channel.profileImageUrl",
    label: "채널 프로필 이미지 URL",
    group: "channel",
  },
  { key: "week.startAt", label: "주 시작일 (ISO)", group: "week" },
  { key: "week.endAt", label: "주 종료일 (ISO)", group: "week" },
  {
    key: "week.rangeLabel",
    label: "주 범위 (예: 4/21 - 4/27)",
    group: "week",
  },
  ...DAY_LABELS.flatMap((_, i) => [
    {
      key: `day[${i}].title`,
      label: `${DAY_LABELS[i]}요일 — 방송 제목`,
      group: "day" as const,
      dayIndex: i,
    },
    {
      key: `day[${i}].startTime`,
      label: `${DAY_LABELS[i]}요일 — 시작 시각`,
      group: "day" as const,
      dayIndex: i,
    },
    {
      key: `day[${i}].status`,
      label: `${DAY_LABELS[i]}요일 — 상태 (LIVE/COLLAB/OFF/ETC/TBD)`,
      group: "day" as const,
      dayIndex: i,
    },
  ]),
];

// 위 spread 가 만들어내는 day 항목 순서가 (요일별 묶음) 인지 확인하기 위한
// 빌드 헬퍼 — 함수형 정의를 쓰면 가독성이 더 좋지만 위 인라인이
// "한 눈에 카탈로그를 본다" 라는 사용자 요구에 더 가깝다.
// 만약 "필드별 묶음 (모든 요일의 title → 모든 요일의 startTime …)" 이 더 좋다고
// 판단되면 buildDayBindings 헬퍼로 바꿔치기.
void buildDayBindings;

/**
 * ImageSlot 용 — image-yielding binding 만 노출.
 *
 * 백엔드 결과 정의:
 *  - `channel.profileImageUrl` → 채널 프로필 이미지 URL (string|null)
 *  - `day[N].thumbnail`        → 일정 썸네일 URL (현재 백엔드 MVP 가 항상 null 이므로
 *                                실제로는 fallbackUrl 로 fallback. 그래도 사용자가
 *                                의도를 표현할 수 있도록 노출.)
 */
export const IMAGE_BINDING_CATALOG: readonly BindingOption[] = [
  {
    key: "channel.profileImageUrl",
    label: "채널 프로필 이미지",
    group: "channel",
  },
  ...DAY_LABELS.map((dayLabel, dayIndex) => ({
    key: `day[${dayIndex}].thumbnail`,
    label: `${dayLabel}요일 — 썸네일`,
    group: "day" as const,
    dayIndex,
  })),
];

/**
 * `slotType` 에 맞는 카탈로그에서 key 로 옵션을 찾는다.
 * 매칭이 없으면 undefined — 호출자가 free-form binding (사용자가 직접 입력하거나
 * 카탈로그에 없는 표현) 을 어떻게 처리할지 결정.
 */
export function findBindingOption(
  slotType: "text" | "image",
  key: string,
): BindingOption | undefined {
  const catalog = slotType === "image" ? IMAGE_BINDING_CATALOG : BINDING_CATALOG;
  return catalog.find((opt) => opt.key === key);
}
