import { exact, token } from '../../features/chat/contract';

export interface Session { authenticated: true; soopLinkStatus: 'VERIFIED' | 'REQUIRED'; csrfToken: string; accountPartition: string }

/** One cookie-session contract for account, chat and privacy consumers. */
export function parseSession(value: unknown): Session {
  const data = exact(value, ['authenticated', 'soopLinkStatus', 'csrfToken', 'accountPartition'], ['onboardingState', 'capabilities']);
  if (data.authenticated !== true || typeof data.csrfToken !== 'string' || data.csrfToken.length < 16 || (data.soopLinkStatus !== 'VERIFIED' && data.soopLinkStatus !== 'REQUIRED')) throw new Error('INVALID_SESSION');
  const accountPartition = token(data.accountPartition);
  // Admission fields are additive as a pair, but must agree with linkage.
  if ('onboardingState' in data || 'capabilities' in data) {
    const capabilities = exact(data.capabilities, ['chat']);
    const linked = data.soopLinkStatus === 'VERIFIED';
    if (data.onboardingState !== (linked ? 'READY' : 'SOOP_LINK_REQUIRED') || capabilities.chat !== linked) throw new Error('INVALID_SESSION');
  }
  return { authenticated: true, soopLinkStatus: data.soopLinkStatus, csrfToken: data.csrfToken, accountPartition };
}
