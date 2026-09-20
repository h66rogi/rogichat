/**
 * The single seam between this module and the shared API client.
 *
 * `src/core/api/client.ts` is owned outside this module and currently sends GET/POST/PATCH
 * only, and it discards the error envelope. M11 additionally needs PUT and DELETE-with-body,
 * and the enrollment states depend on the distinction between 403 FORBIDDEN,
 * 403 SOOP_LINK_REQUIRED and 503 AUTH_UNAVAILABLE. This port states exactly what the client
 * adapter must provide so no part of the transport has to be guessed here:
 *
 *  - same-origin API host with `credentials: 'include'`, `cache: 'no-store'`, `redirect: 'error'`;
 *  - `X-CSRF-Token` on every mutation (PUT/POST/DELETE), from the current session;
 *  - JSON request body for every mutation, including DELETE;
 *  - resolve for any HTTP status, including 4xx/5xx: return the status and the parsed JSON body
 *    (`{error:{code}}` for failures, `null` for 204 and for non-JSON bodies). Never throw on a
 *    non-2xx status, and never surface the raw body text;
 *  - reject only when the request never completed (network failure, abort, timeout).
 *
 * See docs/web-push-integration.md for the wiring contract.
 */
export interface PushHttpRequest {
  path: string;
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export interface PushHttpResponse {
  status: number;
  /** Parsed JSON body, or null for an empty (204) or non-JSON response. */
  json: unknown;
}

export type PushHttp = (request: PushHttpRequest) => Promise<PushHttpResponse>;
