const CHANNEL_PUBLIC_RE = /^\/channel\/([^/]+)(?:\/(.*))?$/;
const RESERVED_CHANNEL_ROOT_SEGMENTS = new Set(['create', 'transfer']);

export type PublicChannelRoute = {
  user: string;
  rest: string;
};

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function resolvePublicChannelRoute(
  pathname: string | null,
): PublicChannelRoute | null {
  const match = pathname?.match(CHANNEL_PUBLIC_RE);
  if (!match) return null;

  const user = decodePathSegment(match[1]);
  const rest = match[2] ?? '';
  const firstChildSegment = rest.split('/')[0];

  if (
    RESERVED_CHANNEL_ROOT_SEGMENTS.has(user) ||
    firstChildSegment === 'manage' ||
    firstChildSegment === 'live'
  ) {
    return null;
  }

  return { user, rest };
}
