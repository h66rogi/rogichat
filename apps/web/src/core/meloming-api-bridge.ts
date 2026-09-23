/** Rogichat transport boundary for the copied Meloming API clients. */
export function rogichatApiOrigin(): string {
  if (typeof window !== 'undefined') {
    if (window.location.origin === 'https://qa.rogi.chat') return 'https://api.qa.rogi.chat';
    if (window.location.origin === 'https://rogi.chat') return 'https://api.rogi.chat';
  } else {
    const configured = process.env.ROGICHAT_API_ORIGIN;
    if (configured === 'https://api.qa.rogi.chat' || configured === 'https://api.rogi.chat') return configured;
  }
  throw new Error('Rogichat API origin is unavailable.');
}

export async function rogichatCsrfToken(): Promise<string> {
  const response = await fetch(`${rogichatApiOrigin()}/v1/auth/session`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Authentication is required.');
  const session: unknown = await response.json();
  if (!session || typeof session !== 'object' || !('authenticated' in session) || session.authenticated !== true ||
      !('csrfToken' in session) || typeof session.csrfToken !== 'string' || session.csrfToken.length < 16) {
    throw new Error('Invalid Rogichat session.');
  }
  return session.csrfToken;
}
