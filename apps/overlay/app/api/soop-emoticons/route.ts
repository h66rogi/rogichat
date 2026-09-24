import { NextResponse } from 'next/server';

// SOOP global emoticon catalog — fetched once per server lifetime and
// served to overlay clients. The upstream endpoint is plain JSON without
// CORS headers, so we proxy through a same-origin route to let any theme
// Chatbox resolve `/응원봉/`-style tokens to image URLs.
const SOOP_CATALOG_URL = 'https://st.sooplive.com/api/emoticons.php';

// Allow Next to revalidate the response on demand. The catalog rarely
// changes (server-side static asset versioned by `version` field on each
// entry), so a long stale window is acceptable.
export const revalidate = 21600; // 6 hours

export async function GET(): Promise<NextResponse> {
  try {
    const upstream = await fetch(SOOP_CATALOG_URL, {
      headers: {
        // SOOP rejects requests without a recognisable Referer.
        Referer: 'https://play.sooplive.com/',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      },
      next: { revalidate },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `SOOP upstream ${upstream.status}` },
        { status: 502 },
      );
    }

    const body = (await upstream.json()) as unknown;
    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 502 },
    );
  }
}
