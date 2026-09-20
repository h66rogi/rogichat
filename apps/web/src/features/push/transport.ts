/**
 * The transport seam for the enrollment calls.
 *
 * `http.ts` implements this port for production and is what the settings wiring uses; the
 * port itself exists so the lifecycle and its failure states can be tested without a network.
 * Any other implementation must behave the same way:
 *
 *  - approved API origin, `credentials: 'include'`, `cache: 'no-store'`, `redirect: 'error'`;
 *  - the current session's `X-CSRF-Token` on every mutation (PUT/POST/DELETE), read per request;
 *  - a JSON request body on every mutation, including DELETE;
 *  - resolve for any HTTP status, including 4xx/5xx: return the response's own status — never
 *    one inferred from the method — and the parsed JSON body (`{error:{code}}` for a failure
 *    whose code the contract defines for that status, `null` otherwise and for 204). Never
 *    throw on a non-2xx status, and never surface raw body text;
 *  - reject only when the request never completed (network failure, abort, timeout), keeping
 *    `AbortError`'s name so the account/session fence can tell an abort from a network failure,
 *    or with a `PushError` for a state it already knows, such as an unusable session token.
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
  /** Parsed JSON body, or null for an empty (204), non-JSON or untrusted body. */
  json: unknown;
}

export type PushHttp = (request: PushHttpRequest) => Promise<PushHttpResponse>;
