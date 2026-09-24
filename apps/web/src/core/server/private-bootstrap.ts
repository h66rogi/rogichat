import 'server-only';
import { cookies } from 'next/headers';
import { parseSession, sessionAllowsChat } from '@/core/api/session-contract';
import { validateProfile, type Profile, type Session } from '@/core/api/client';
import { runtimeConfig } from '@/core/runtime/config';

export const RENDER_LOCK_COOKIE = '__Host-rogi_private_render_lock';
export const sessionCookieName = (environment: 'qa' | 'production') => environment === 'qa' ? '__Secure-rogi_qa_session' : '__Secure-rogi_prod_session';

export type ServerPrivateBootstrap = { state: { kind: 'checking' | 'unauthenticated' } | { kind: 'linkRequired'; session: Session } | { kind: 'ready'; session: Session; profile: Profile; generation: number } };

/** QA can receive the production Domain cookie too; forward only the exact environment name. */
export async function serverSessionCredential(): Promise<{ name: string; token: string } | null> {
  const jar = await cookies();
  if (jar.has(RENDER_LOCK_COOKIE)) return null;
  const name = sessionCookieName(runtimeConfig().environment);
  const token = jar.get(name)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? { name, token } : null;
}

/** Only this environment's credential is forwarded. No private response enters a shared cache. */
export async function loadPrivateBootstrap(): Promise<ServerPrivateBootstrap> {
  const credential = await serverSessionCredential();
  if (!credential) return { state: { kind: (await cookies()).has(RENDER_LOCK_COOKIE) ? 'checking' : 'unauthenticated' } };
  const { apiOrigin } = runtimeConfig();
  const read = async (path: string): Promise<unknown> => {
    const response = await fetch(apiOrigin + path, { method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { accept: 'application/json', cookie: `${credential.name}=${credential.token}` }, signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('PRIVATE_BOOTSTRAP_UNAVAILABLE');
    return response.json();
  };
  try {
    const session = parseSession(await read('/v1/auth/session'));
    if (!sessionAllowsChat(session)) return { state: { kind: 'linkRequired', session } };
    const [profile, confirmed] = await Promise.all([read('/v1/me/profile').then(value => validateProfile(value as Profile)), read('/v1/auth/session').then(parseSession)]);
    if (confirmed.csrfToken !== session.csrfToken || confirmed.accountPartition !== session.accountPartition || !sessionAllowsChat(confirmed)) throw new Error('PRIVATE_BOOTSTRAP_CHANGED');
    return { state: { kind: 'ready', session: confirmed, profile, generation: 1 } };
  } catch { return { state: { kind: 'checking' } }; }
}
