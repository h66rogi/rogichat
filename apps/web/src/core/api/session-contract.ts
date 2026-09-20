import { exact, token } from '../../features/chat/contract';

export interface Session { authenticated: true; soopLinkStatus: 'VERIFIED' | 'REQUIRED'; csrfToken: string; accountPartition: string; onboardingState?: 'READY' | 'SOOP_LINK_REQUIRED'; capabilities?: { chat: boolean } }

/** Explicit server admission may authorize a real reviewer without claiming SOOP linkage. */
export function sessionAllowsChat(session: Session): boolean {
  return session.capabilities ? session.capabilities.chat === true && session.onboardingState === 'READY' : session.soopLinkStatus === 'VERIFIED';
}
export function parseSession(value: unknown): Session {
  const data = exact(value, ['authenticated', 'soopLinkStatus', 'csrfToken', 'accountPartition'], ['onboardingState', 'capabilities']);
  if (data.authenticated !== true || typeof data.csrfToken !== 'string' || data.csrfToken.length < 16 || (data.soopLinkStatus !== 'VERIFIED' && data.soopLinkStatus !== 'REQUIRED')) throw new Error('INVALID_SESSION');
  const accountPartition = token(data.accountPartition);
  const base: Session = { authenticated: true, soopLinkStatus: data.soopLinkStatus, csrfToken: data.csrfToken, accountPartition };
  if ('onboardingState' in data || 'capabilities' in data) {
    const capabilities = exact(data.capabilities, ['chat']);
    if (typeof capabilities.chat !== 'boolean' || data.onboardingState !== (capabilities.chat ? 'READY' : 'SOOP_LINK_REQUIRED')) throw new Error('INVALID_SESSION');
    return { ...base, onboardingState: capabilities.chat ? 'READY' : 'SOOP_LINK_REQUIRED', capabilities: { chat: capabilities.chat } };
  }
  return base;
}
