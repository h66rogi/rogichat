import { PushError } from './errors';
import type { PushHttp, PushHttpRequest, PushHttpResponse } from './transport';

/**
 * Production transport for the push enrollment calls.
 *
 * It is the real adapter the settings wiring uses; `PushHttp` stays a port only so the
 * lifecycle can be tested without a network. The discipline matches the rest of the app's
 * clients: an approved API origin, cookie credentials with the current CSRF token read per
 * request, no redirects, no HTTP cache, a bounded JSON read under a request deadline, and an
 * error envelope that is trusted only for the codes the contract defines for that status.
 *
 * The reported status is always the response's own status. Nothing is inferred from the
 * method, and a failure never becomes a value the lifecycle can read as success.
 */
const APPROVED_ORIGINS = ['https://api.qa.rogi.chat', 'https://api.rogi.chat'];
/** Enrollment responses are a handful of fields; the error envelope is smaller still. */
const MAX_BODY_BYTES = 8 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
/** The server issues a 43-character base64url token (auth-primitives `secret()`). */
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PUSH_PATH = /^\/v1\/(me\/(push-capabilities|notification-preferences|push-subscriptions(\/[0-9a-f-]{36})?))$/;

/** Error codes this module accepts, per status, from the `{"error":{"code":…}}` envelope. */
const ERROR_CODES: Record<number, readonly string[]> = {
  400: ['INVALID_REQUEST'],
  401: ['UNAUTHENTICATED'],
  403: ['FORBIDDEN', 'SOOP_LINK_REQUIRED'],
  404: ['NOT_FOUND'],
  409: ['CONFLICT'],
  429: ['RATE_LIMITED'],
  503: ['AUTH_UNAVAILABLE', 'UNAVAILABLE'],
};

export interface PushHttpOptions {
  readonly apiOrigin: string;
  /** Reads the current session's CSRF token at request time, never a captured stale one. */
  readonly csrf: () => string;
  readonly transport?: typeof fetch;
}

/** Builds the production `PushHttp`. Throws for an unapproved origin. */
export function pushHttp(options: PushHttpOptions): PushHttp {
  if (!APPROVED_ORIGINS.includes(options.apiOrigin)) throw new TypeError('Unapproved API origin');
  const transport = options.transport ?? fetch;
  const send: typeof fetch = (input, init) => transport(input, init);

  return async (request: PushHttpRequest): Promise<PushHttpResponse> => {
    if (!PUSH_PATH.test(request.path)) throw new TypeError('Invalid push API path');
    const write = request.method !== 'GET';
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (write) {
      const csrf = options.csrf();
      // A session without a usable token cannot mutate; that is an authentication state,
      // not a transport failure, and it must not reach the network.
      if (!CSRF_TOKEN.test(csrf)) throw new PushError('unauthenticated', 401);
      headers['X-CSRF-Token'] = csrf;
      headers['Content-Type'] = 'application/json';
    }
    const signal = AbortSignal.any(request.signal ? [request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)] : [AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    const response = await send(options.apiOrigin + request.path, {
      method: request.method,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      headers,
      signal,
      ...(write ? { body: JSON.stringify(request.body ?? {}) } : {}),
    });
    return { status: response.status, json: await readBody(response, signal) };
  };
}

/**
 * Reads at most `MAX_BODY_BYTES` of JSON. An empty, oversized, non-JSON or unparseable body
 * yields null, and an error envelope yields the body only when its code is one the contract
 * defines for that status. Callers treat null as "no usable body", never as success.
 */
async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.status === 204) return null;
  if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return null;
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) return null;
  const reader = response.body?.getReader();
  if (reader === undefined) return null;

  const cancel = (): void => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  let text = '';
  try {
    const decoder = new TextDecoder();
    let size = 0;
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) return null;
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return response.ok ? value : allowedEnvelope(response.status, value);
}

function allowedEnvelope(status: number, value: unknown): unknown {
  if (!value || typeof value !== 'object') return null;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && ERROR_CODES[status]?.includes(code) ? { error: { code } } : null;
}
