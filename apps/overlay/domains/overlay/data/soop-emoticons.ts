// Client-side SOOP global emoticon catalog cache.
//
// SOOP does not ship an inline emote map on chat frames the way CHZZK and
// ci.me do — instead, every signature/global keyword (e.g. `/응원봉/`) is
// resolved against this static catalog. We fetch it through a same-origin
// API route (avoids CORS) once per browser session and memoise the parsed
// lookup map at module scope.

export interface SoopEmoticonEntry {
  keyword: string; // e.g. "/응원봉/"
  fileName: string; // e.g. "1.png" or "225.webp"
  staticFileName?: string; // png fallback when fileName is animated webp
  version: number;
}

export interface SoopEmoticonCatalog {
  smallUrl: string;
  bigUrl: string;
  // keyword (with surrounding slashes) → entry
  byKeyword: Map<string, SoopEmoticonEntry>;
}

interface SoopUpstream {
  result: number;
  data?: {
    default?: { small_url?: string; big_url?: string; groups?: SoopGroup[] };
    subscribe?: { groups?: SoopGroup[] };
  };
}

interface SoopGroup {
  emoticons?: Array<{
    keyword?: string;
    fileName?: string;
    staticFileName?: string;
    isDeprecated?: boolean;
    version?: number;
  }>;
}

let catalogPromise: Promise<SoopEmoticonCatalog | null> | null = null;

export function getSoopCatalog(): Promise<SoopEmoticonCatalog | null> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = fetchAndParse().catch(() => null);
  return catalogPromise;
}

async function fetchAndParse(): Promise<SoopEmoticonCatalog | null> {
  const res = await fetch('/api/soop-emoticons', { cache: 'force-cache' });
  if (!res.ok) return null;
  const json = (await res.json()) as SoopUpstream;
  if (!json?.data?.default) return null;

  const smallUrl = json.data.default.small_url ?? '';
  const bigUrl = json.data.default.big_url ?? '';
  const byKeyword = new Map<string, SoopEmoticonEntry>();

  const collect = (groups: SoopGroup[] | undefined): void => {
    for (const group of groups ?? []) {
      for (const entry of group.emoticons ?? []) {
        if (!entry.keyword || !entry.fileName || entry.isDeprecated) continue;
        byKeyword.set(entry.keyword, {
          keyword: entry.keyword,
          fileName: entry.fileName,
          staticFileName: entry.staticFileName,
          version: entry.version ?? 0,
        });
      }
    }
  };

  collect(json.data.default.groups);
  collect(json.data.subscribe?.groups);

  return { smallUrl, bigUrl, byKeyword };
}

// `code` is the bare token (without slashes); the catalog is keyed by the
// full `/code/` form so we wrap before lookup.
export function resolveSoopEmote(
  catalog: SoopEmoticonCatalog,
  code: string,
): { url: string; animated: boolean } | null {
  const entry = catalog.byKeyword.get(`/${code}/`);
  if (!entry) return null;
  const url = `${catalog.smallUrl}${entry.fileName}?v=${entry.version}`;
  const animated = entry.fileName.endsWith('.webp');
  return { url, animated };
}
