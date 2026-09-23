/**
 * 클라이언트 미리보기(F9) 디바운스 트리거 키 계산.
 *
 *  - `total` 만 보면 동일 개수 일정의 title/startAt/endAt/isCanceled 변경이
 *    누락된다 (Codex F9 IMPORTANT). title 만 바뀌어도 미리보기가 갱신되지
 *    않으면 사용자가 "왜 안 바뀌지?" 혼란을 겪는다.
 *  - 따라서 렌더에 영향을 주는 모든 필드를 콘텐츠 해시로 묶어 trigger 한다.
 *  - 입력 schedules 는 임의의 채널 일정 형태에서 필요한 필드만 가진 최소
 *    공통 부분집합 — 호출 측이 `Schedule[]` 을 그대로 넘길 수 있다.
 *
 * @returns trigger key 문자열. 컴포넌트가 useMemo dep 으로 사용 가능.
 */
export interface PreviewTriggerScheduleSnapshot {
  id: number;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  isCanceled: boolean;
  status: string;
}

export interface ComputePreviewTriggerKeyInput {
  templateId: number;
  templateUpdatedAt: string;
  /** UTC Date — KST 월요일 자정의 UTC 표현. 일관성 위해 number(ms) 로 변환. */
  weekStartMs: number;
  schedules: ReadonlyArray<PreviewTriggerScheduleSnapshot>;
}

/**
 * 안정적인 trigger key 문자열을 만든다. 동일 input → 동일 output (멱등).
 *
 * 길이는 일정 개수에 비례 (한 일정당 ~50bytes). 한 주(7일) 채널은 보통 5~20개
 * 사이라 string 비교 비용은 무시 가능.
 */
export function computePreviewTriggerKey(
  input: ComputePreviewTriggerKeyInput,
): string {
  const itemsHash = input.schedules
    .map(
      (s) =>
        `${s.id}|${s.title}|${s.startAt}|${s.endAt ?? ""}|${s.allDay ? 1 : 0}|${s.isCanceled ? 1 : 0}|${s.status}`,
    )
    .join("\n");
  return `${input.templateId}:${input.templateUpdatedAt}:${input.weekStartMs}:${input.schedules.length}:${itemsHash}`;
}
