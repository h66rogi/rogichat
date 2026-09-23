import type { Prisma } from '../../../generated/prisma/client.js';
import { ALBUM_ART_BLOCKED_URL_PREFIXES } from './album-art-blacklist.js';

type CreateSongDto = {albumArt?:string|null;autoSearchAlbumArt?:boolean;artistName?:string;title:string};

export class SongAlbumArtService {
  private readonly blockedAlbumArtPrefixes = ALBUM_ART_BLOCKED_URL_PREFIXES;

  constructor(private readonly prisma: Prisma.TransactionClient) {}

  sanitizeAlbumArtUrl(
    url: string | null | undefined,
  ): string | null | undefined {
    if (url === undefined) {
      return undefined;
    }
    if (url === null) {
      return null;
    }
    return this.isBlockedAlbumArtUrl(url) ? null : url;
  }

  async searchAlbumArtFromDB(title: string, artist: string) {
    try {
      const exactMatch = await this.findExactMatch(title, artist);
      if (exactMatch) {
        return {
          success: true,
          result: {
            albumArt: exactMatch.albumArt,
            title: exactMatch.title,
            artistName: exactMatch.artist.name,
            matchType: 'exact',
          },
        };
      }

      const normalizedMatch = await this.findNormalizedMatch(title, artist);
      if (normalizedMatch) {
        return {
          success: true,
          result: {
            albumArt: normalizedMatch.albumArt,
            title: normalizedMatch.title,
            artistName: normalizedMatch.artist.name,
            matchType: 'normalized',
          },
        };
      }

      const titleMatch = await this.findTitleOnlyMatch(title);
      if (titleMatch) {
        return {
          success: true,
          result: {
            albumArt: titleMatch.albumArt,
            title: titleMatch.title,
            artistName: titleMatch.artist.name,
            matchType: 'title_only',
          },
        };
      }

      const artistMatch = await this.findArtistOnlyMatch(artist);
      if (artistMatch) {
        return {
          success: true,
          result: {
            albumArt: artistMatch.albumArt,
            title: artistMatch.title,
            artistName: artistMatch.artist.name,
            matchType: 'artist_only',
          },
        };
      }

      return { success: false, result: null };
    } catch (error) {
      void error;
      return { success: false, result: null };
    }
  }

  async bulkSearchAlbumArtFromDB(songs: { title: string; artist: string }[]) {
    try {
      type Row = {
        albumArt: string | null;
        title: string;
        artist: { name: string };
      };
      type Result = {
        success: boolean;
        requestIndex: number;
        requestTitle: string;
        requestArtist: string;
        result: {
          albumArt: string | null;
          title: string;
          artistName: string;
          matchType: string;
        } | null;
        error?: string;
      };

      const resultsByIndex: Array<Result | undefined> = new Array(
        songs.length,
      ).fill(undefined);
      const fill = (i: number, r: Row, type: string) => {
        if (!resultsByIndex[i]) {
          resultsByIndex[i] = {
            success: true,
            requestIndex: i,
            requestTitle: songs[i]!.title,
            requestArtist: songs[i]!.artist,
            result: {
              albumArt: r.albumArt ?? null,
              title: r.title,
              artistName: r.artist.name,
              matchType: type,
            },
          };
        }
      };
      const pending = () =>
        resultsByIndex
          .map((r, i) => ({ r, i }))
          .filter((x) => !x.r)
          .map((x) => x.i);

      if (songs.length > 0) {
        const uniqueTitles = Array.from(new Set(songs.map((s) => s.title)));
        const exactRows = await this.prisma.song.findMany({
          where: {
            AND: [
              { title: { in: uniqueTitles } },
              { albumArt: { not: null } },
              { albumArt: { not: '' } },
            ],
          },
          select: {
            albumArt: true,
            title: true,
            artist: { select: { name: true } },
          },
        });
        const map = new Map<string, Row>();
        exactRows.forEach((row) =>
          map.set(`${row.title}::${row.artist.name}`, row),
        );
        songs.forEach((s, idx) => {
          const row = map.get(`${s.title}::${s.artist}`);
          if (row) fill(idx, row, 'exact');
        });
      }

      const p1 = pending();
      if (p1.length > 0) {
        const normalizedTitleSet = new Set<string>();
        for (const idx of p1) {
          const t = songs[idx]!.title;
          const nt = t.replace(/\s+/g, '');
          const nt2 = nt.replace(/[^\w가-힣]/g, '');
          normalizedTitleSet.add(nt);
          normalizedTitleSet.add(nt2);
        }
        const normalizedTitles = Array.from(normalizedTitleSet);
        if (normalizedTitles.length > 0) {
          const normalizedRows = await this.prisma.song.findMany({
            where: {
              AND: [
                { title: { in: normalizedTitles } },
                { albumArt: { not: null } },
                { albumArt: { not: '' } },
              ],
            },
            select: {
              albumArt: true,
              title: true,
              artist: { select: { name: true } },
            },
          });
          for (const idx of p1) {
            const t = songs[idx]!.title;
            const a = songs[idx]!.artist;
            const nt = t.replace(/\s+/g, '');
            const na = a.replace(/\s+/g, '');
            const nt2 = nt.replace(/[^\w가-힣]/g, '');
            const na2 = na.replace(/[^\w가-힣]/g, '');
            const row = normalizedRows.find((r) => {
              if (!(r.title === nt || r.title === nt2)) return false;
              const ra = r.artist.name.replace(/\s+/g, '');
              const ra2 = ra.replace(/[^\w가-힣]/g, '');
              return ra === na || ra2 === na2;
            });
            if (row) fill(idx, row, 'normalized');
          }
        }
      }

      const p2 = pending();
      const processInBatches = async (
        indices: number[],
        batchSize: number,
        handler: (i: number) => Promise<void>,
      ) => {
        for (let i = 0; i < indices.length; i += batchSize) {
          const slice = indices.slice(i, i + batchSize);
          await Promise.all(slice.map((idx) => handler(idx)));
        }
      };

      if (p2.length > 0) {
        const titleToIdx = new Map<string, number[]>();
        for (const idx of p2) {
          const t = songs[idx]!.title;
          const list = titleToIdx.get(t) ?? [];
          list.push(idx);
          titleToIdx.set(t, list);
        }
        const titles = Array.from(titleToIdx.keys());
        await processInBatches(
          titles.map((_, i) => i),
          10,
          async (ti) => {
            const title = titles[ti]!;
            const indices = (titleToIdx.get(title) ?? []).filter(
              (i) => !resultsByIndex[i],
            );
            if (indices.length === 0) return;
            const row = await this.findTitleOnlyMatch(title);
            if (row)
              indices.forEach((idx) => fill(idx, row as Row, 'title_only'));
          },
        );
      }

      const p3 = pending();
      if (p3.length > 0) {
        const artistToIdx = new Map<string, number[]>();
        for (const idx of p3) {
          const a = songs[idx]!.artist;
          const list = artistToIdx.get(a) ?? [];
          list.push(idx);
          artistToIdx.set(a, list);
        }
        const artists = Array.from(artistToIdx.keys());
        await processInBatches(
          artists.map((_, i) => i),
          10,
          async (ai) => {
            const artist = artists[ai]!;
            const indices = (artistToIdx.get(artist) ?? []).filter(
              (i) => !resultsByIndex[i],
            );
            if (indices.length === 0) return;
            const row = await this.findArtistOnlyMatch(artist);
            if (row)
              indices.forEach((idx) => fill(idx, row as Row, 'artist_only'));
          },
        );
      }

      for (let i = 0; i < songs.length; i++) {
        if (!resultsByIndex[i]) {
          resultsByIndex[i] = {
            success: false,
            requestIndex: i,
            requestTitle: songs[i]!.title,
            requestArtist: songs[i]!.artist,
            result: null,
          };
        }
      }

      const finalized = resultsByIndex.filter(
        (r): r is NonNullable<typeof r> => r !== undefined,
      );
      const successCount = finalized.filter((r) => r.success).length;
      return {
        success: true,
        totalRequested: songs.length,
        successCount,
        failCount: finalized.length - successCount,
        results: finalized,
      };
    } catch (error) {
      void error;
      return {
        success: false,
        error: (error as Error).message,
        totalRequested: songs.length,
        successCount: 0,
        failCount: songs.length,
        results: [],
      };
    }
  }

  async processAlbumArt(
    songDto: CreateSongDto,
    artistId: number,
    prisma: Prisma.TransactionClient = this.prisma,
  ): Promise<string | null> {
    let finalAlbumArt = songDto.albumArt;
    if (!finalAlbumArt && songDto.autoSearchAlbumArt) {
      const artistName =
        songDto.artistName ||
        (artistId
          ? (await prisma.artist.findUnique({ where: { id: artistId } }))?.name
          : undefined);
      if (artistName) {
        const albumArtResult = await this.searchAlbumArtFromDB(
          songDto.title,
          artistName,
        );
        if (albumArtResult.success && albumArtResult.result)
          finalAlbumArt = albumArtResult.result.albumArt;
      }
    }
    const sanitizedAlbumArt = this.sanitizeAlbumArtUrl(finalAlbumArt);
    return sanitizedAlbumArt ?? null;
  }

  // ===== Private finders =====
  private async findExactMatch(title: string, artist: string) {
    return await this.prisma.song.findFirst({
      where: {
        AND: [
          { title: { equals: title } },
          { artist: { name: { equals: artist } } },
          { albumArt: { not: null } },
          { albumArt: { not: '' } },
        ],
      },
      include: { artist: true },
    });
  }

  private async findNormalizedMatch(title: string, artist: string) {
    const normalizedTitle = title.replace(/\s+/g, '');
    const normalizedArtist = artist.replace(/\s+/g, '');
    return await this.prisma.song.findFirst({
      where: {
        AND: [
          {
            OR: [
              { title: { equals: normalizedTitle } },
              { title: { equals: normalizedTitle.replace(/[^\w가-힣]/g, '') } },
            ],
          },
          {
            artist: {
              OR: [
                { name: { equals: normalizedArtist } },
                {
                  name: { equals: normalizedArtist.replace(/[^\w가-힣]/g, '') },
                },
              ],
            },
          },
          { albumArt: { not: null } },
          { albumArt: { not: '' } },
        ],
      },
      include: { artist: true },
    });
  }

  private async findTitleOnlyMatch(title: string) {
    // contains 분기 제거: MySQL LIKE %x% 는 인덱스 미사용 → song 테이블 풀스캔.
    // exact match 만 사용하면 title 단독 인덱스(없으면 추가 가능)만으로 빠르게 처리됨.
    return await this.prisma.song.findFirst({
      where: {
        AND: [
          { title: { equals: title } },
          { albumArt: { not: null } },
          { albumArt: { not: '' } },
        ],
      },
      include: { artist: true },
    });
  }

  private async findArtistOnlyMatch(artist: string) {
    // contains 분기 제거 — 풀스캔 회피. artist.name equals 만 사용.
    return await this.prisma.song.findFirst({
      where: {
        AND: [
          { artist: { name: { equals: artist } } },
          { albumArt: { not: null } },
          { albumArt: { not: '' } },
        ],
      },
      include: { artist: true },
    });
  }

  private isBlockedAlbumArtUrl(url: string): boolean {
    try {
      const href = new URL(url).href;
      return this.blockedAlbumArtPrefixes.some((prefix) =>
        href.startsWith(prefix),
      );
    } catch {
      return false;
    }
  }
}
