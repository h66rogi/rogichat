/**
 * Session gate state for private screens (chat, settings).
 *
 * The web app cannot assume an authenticated server render: the API issues host-only HttpOnly cookies
 * on `api.qa.rogi.chat`, which the Next server never receives. Private screens therefore check the
 * session in the browser first and render nothing private until a gate state allows it.
 *
 * FW01 ships the state model and the adapter boundary only. The real adapter is connected in FW03 once
 * the W02 bootstrap and W08 completion contracts exist. Until then the adapter reports `unavailable`, and
 * the UI must present that honestly rather than pretend a login or a room join happened.
 */
export type SessionGateState =
  | { kind: 'checking' }
  | { kind: 'unavailable'; reason: 'auth_not_connected' }
  | { kind: 'unauthenticated' }
  | { kind: 'soopLinkRequired' }
  | { kind: 'notJoined' }
  | { kind: 'joined' }
  | { kind: 'roomUnavailable' }
  | { kind: 'networkError' };

export interface SessionGateAdapter {
  /** Re-checks the current session. Callers treat a resolved value as a snapshot, never as a credential. */
  check(signal: AbortSignal): Promise<SessionGateState>;
}

/** FW01 adapter: no session, bootstrap or join contract is connected yet. */
export const unavailableSessionGateAdapter: SessionGateAdapter = {
  check() {
    return Promise.resolve({ kind: 'unavailable', reason: 'auth_not_connected' });
  },
};
