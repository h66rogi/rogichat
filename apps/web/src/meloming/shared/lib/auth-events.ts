/**
 * Auth refresh broadcast.
 *
 * api-client interceptor가 /auth/refresh를 성공시키면 emitAuthRefreshed()를 호출하고,
 * 최상위 client provider(AuthRefreshListener)가 이를 받아
 * 인증 의존 React Query를 invalidate + RSC를 router.refresh()로 재실행한다.
 */

const EVENT_NAME = "meloming:auth-refreshed";

function getTarget(): EventTarget | null {
  if (typeof window === "undefined") return null;
  return window;
}

export function emitAuthRefreshed(): void {
  const target = getTarget();
  if (!target) return;
  target.dispatchEvent(new Event(EVENT_NAME));
}

export function onAuthRefreshed(listener: () => void): () => void {
  const target = getTarget();
  if (!target) return () => {};
  target.addEventListener(EVENT_NAME, listener);
  return () => {
    target.removeEventListener(EVENT_NAME, listener);
  };
}
