/**
 * URL 세그먼트에서 받은 템플릿 id 문자열을 양의 정수로 변환한다.
 *
 * 왜 `Number.parseInt` 대신 정규식을 먼저 거치는가:
 * - `Number.parseInt("1abc", 10)` 은 `1` 을 반환해 유효한 id 로 오해됨
 * - `Number("  1  ")` 등 공백 포함 값도 성공하므로 엄격히 차단
 *
 * 범위 제약:
 * - Postgres BIGINT 범위는 넘어서도 실제 사용 범위는 `Number.isSafeInteger`
 *   로 충분하다. 더 큰 값이 들어오면 애초에 존재하지 않는 id 라 404 로 판정.
 *
 * @returns 유효한 양의 정수 id, 혹은 형식이 어긋나면 `null`
 */
export function parseTemplateIdParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) return null;
  return value;
}
