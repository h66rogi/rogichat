/**
 * Push failures are surfaced as real states. Nothing here converts a failure into an
 * enabled-looking result, and no server body, endpoint or key text ever reaches a message.
 *
 * Error codes follow the API's `{error:{code}}` envelope (SafeExceptionFilter at backend
 * commit 46bca354c96c4ce972ecf5320f6706e20041d161).
 */

export type PushFailureKind =
  | 'invalid-request'
  | 'unauthenticated'
  | 'forbidden'
  | 'soop-link-required'
  | 'not-found'
  | 'conflict'
  | 'unavailable'
  | 'rate-limited'
  | 'server'
  | 'network'
  | 'invalid-response'
  | 'browser'
  | 'storage';

const MESSAGES: Record<PushFailureKind, string> = {
  'invalid-request': '알림 설정 요청을 서버가 받아들이지 않았습니다. 잠시 후 다시 시도해 주세요.',
  unauthenticated: '로그인이 필요합니다.',
  forbidden: '접근 권한을 다시 확인해 주세요.',
  'soop-link-required': 'SOOP 계정 연결과 최신 약관 동의가 필요합니다.',
  'not-found': '알림 설정을 확인할 수 없어요. 다시 설정해 주세요.',
  conflict: '알림 설정이 다른 곳에서 변경되었습니다. 현재 설정을 다시 확인해 주세요.',
  unavailable: '지금은 알림을 켤 수 없어요. 잠시 후 다시 시도해 주세요.',
  'rate-limited': '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
  server: '요청을 완료하지 못했습니다. 다시 시도해 주세요.',
  network: '서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.',
  'invalid-response': '알림을 확인할 수 없어요. 다시 시도해 주세요.',
  browser: '이 브라우저에서 알림을 사용할 수 없어요.',
  storage: '이 브라우저에서 알림 설정을 유지할 수 없어요. 브라우저 설정을 확인해 주세요.',
};

export class PushError extends Error {
  readonly kind: PushFailureKind;
  /** 0 when the request never produced an HTTP status. */
  readonly status: number;
  constructor(kind: PushFailureKind, status = 0) {
    super(MESSAGES[kind]);
    this.name = 'PushError';
    this.kind = kind;
    this.status = status;
  }
}

/** Reads the closed error-code envelope; anything else is treated as no code at all. */
export function errorCode(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const error = (json as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : null;
}

export function classify(status: number, json: unknown): PushError {
  const code = errorCode(json);
  switch (status) {
    case 400: return new PushError('invalid-request', status);
    case 401: return new PushError('unauthenticated', status);
    // 403 carries either FORBIDDEN or the platform-link requirement; they are different states.
    case 403: return new PushError(code === 'SOOP_LINK_REQUIRED' ? 'soop-link-required' : 'forbidden', status);
    case 404: return new PushError('not-found', status);
    case 409: return new PushError('conflict', status);
    case 429: return new PushError('rate-limited', status);
    case 503: return new PushError('unavailable', status);
    default: return new PushError(status >= 400 && status < 500 ? 'invalid-request' : 'server', status);
  }
}

/** A changed account or session invalidates in-flight work; it is never a product error state. */
export class PushScopeChanged extends Error {
  constructor() {
    super('Push scope changed');
    this.name = 'PushScopeChanged';
  }
}
