/**
 * Safe login-screen reasons. The legacy failure callback (`/auth/login`) may arrive with arbitrary query
 * parameters from the auth broker. Only these enumerated reasons ever reach the URL or the UI; raw query
 * values are never copied or displayed.
 */
export const LOGIN_REASONS = ['cancelled', 'failed', 'expired', 'link_conflict'] as const;

export type LoginReason = (typeof LOGIN_REASONS)[number];

export function parseLoginReason(value: string | string[] | undefined): LoginReason | null {
  if (typeof value !== 'string') return null;
  return (LOGIN_REASONS as readonly string[]).includes(value) ? (value as LoginReason) : null;
}

export const LOGIN_REASON_MESSAGES: Record<LoginReason, string> = {
  cancelled: '로그인을 취소했어요. 다시 시도할 수 있어요.',
  failed: '로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.',
  expired: '로그인 시도가 만료됐어요. 처음부터 다시 진행해 주세요.',
  link_conflict: '이 SOOP 계정은 다른 로기챗 계정에 이미 연결되어 있어요.',
};

/**
 * Maps the legacy callback query to a safe reason. The current broker contract does not define error
 * codes for the web; any arrival on the failure route is treated as a failed attempt, and an explicit
 * cancel marker as a cancellation. Nothing else from the query is interpreted.
 */
export function reasonFromLegacyFailureQuery(params: URLSearchParams): LoginReason {
  const marker = (params.get('error') ?? params.get('reason') ?? '').toLowerCase();
  if (marker.includes('cancel') || marker.includes('denied')) return 'cancelled';
  return 'failed';
}
