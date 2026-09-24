/** Suppress SSR while a logout/deletion intent still needs the API cookie for recovery. */
async function change(method: 'POST' | 'DELETE'): Promise<void> {
  if (typeof window === 'undefined' || !['https://qa.rogi.chat', 'https://rogi.chat'].includes(window.location.origin)) return;
  const response = await fetch('/auth/private-render-lock', { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('PRIVATE_RENDER_LOCK_FAILED');
}
export const setPrivateRenderLock = () => change('POST');
export const clearPrivateRenderLock = () => change('DELETE');
