import { Injectable, NotFoundException } from '@nestjs/common';
import { GlobalSongMatcherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { parseLrc } from './lrc.parser';

/**
 * etag 후보를 응답에 영향을 주는 모든 source 의 epoch ms 를 결합해 만든다.
 * - GlobalSong.updatedAt (title / albumArt / mxm meta / genres 변경)
 * - GlobalSong.matcherLastAt (matcherStatus 전이 — RESTRICTED ↔ MATCHED 등)
 * - lyrics.updatedAt (body / restrictedKr / subtitleBody 변경)
 * 한 source 라도 invalid (NaN / 0 / null) 이면 etag 발급 안 함 (null 반환).
 * NaN ETag 사고를 차단하고, 캐시 hit 으로 stale meta 가 새는 시나리오 방지.
 */
/**
 * Prisma JSON 컬럼은 array / object / scalar / null 모두 가능. mxm 응답이
 * `[{id, name, vanity}, ...]` 형태이지만 컬럼 자체는 그것을 강제하지 않음.
 * 클라이언트 contract `Array<{...}> | null` 을 지키기 위해 array 가 아니면 null.
 * 각 item 도 string 키만 안전하게 추출.
 */
function normalizeGenres(
  raw: unknown,
): Array<{ id?: number; name?: string; vanity?: string }> | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
    )
    .map((item) => {
      const out: { id?: number; name?: string; vanity?: string } = {};
      if (typeof item.id === 'number') out.id = item.id;
      if (typeof item.name === 'string') out.name = item.name;
      if (typeof item.vanity === 'string') out.vanity = item.vanity;
      return out;
    });
}

function composeEtagSource(
  ...sources: Array<Date | null | undefined>
): string | null {
  const parts: string[] = [];
  for (const s of sources) {
    if (!s) continue;
    const ms = s.getTime();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    parts.push(ms.toString(36));
  }
  return parts.length > 0 ? parts.join('-') : null;
}

/**
 * Lyrics retrieval status — what surfaces should render.
 * - OK              가사 텍스트 노출 가능 (평문 + 선택적 LRC + 선택적 richsync)
 * - UNLINKED        Song에 globalSongId 미연결 (매칭 자체가 없음)
 * - UNMATCHED       GlobalSong은 있으나 매칭 미완료/포기 — PENDING / UNMATCHED /
 *                   MANUAL_NEEDED / IGNORED / MATCHED_DUP_OF_OTHER 전부 포함
 * - PENDING_LYRICS  MATCHED지만 가사 row 없음 (race / fetch 직전, transient)
 * - NO_LYRICS       MATCHED_NO_LYRICS terminal — mxm에 가사 자체가 없는 곡
 *                   (PENDING_LYRICS와 분리. 클라이언트가 폴링으로 무한 대기 방지)
 * - RESTRICTED      KR 라이선스 제한 — matcherStatus=MATCHED_RESTRICTED 또는
 *                   lyrics.restrictedKr=true. body 절대 비노출
 * - INSTRUMENTAL    연주곡 — matcherStatus=MATCHED_INSTRUMENTAL 또는
 *                   mxmInstrumental=true. body 비노출
 * - ERROR           matcherStatus = ERROR
 */
export type LyricsRetrievalStatus =
  | 'OK'
  | 'UNLINKED'
  | 'UNMATCHED'
  | 'PENDING_LYRICS'
  | 'NO_LYRICS'
  | 'RESTRICTED'
  | 'INSTRUMENTAL'
  | 'ERROR';

export interface LyricsRetrievalSongMeta {
  id: number;
  title: string;
  artist: string;
  karaokeUrl: string | null;
}

export interface LyricsRetrievalGlobalSongMeta {
  id: number;
  title: string;
  artist: string;
  albumArt: string | null;
  mxmAlbumName: string | null;
  mxmTrackLengthSec: number | null;
  primaryIsrc: string | null;
  language: string | null;
  genres: Array<{ id?: number; name?: string; vanity?: string }> | null;
}

export interface LyricsRetrievalLyricsBody {
  body: string;
  bodyKoPron: string | null;
  bodyTranslation: string | null;
  bodyTranslationLanguage: string | null;
  language: string | null;
  synced: {
    format: 'lrc' | null;
    lines: Array<{
      startMs: number;
      text: string;
      koPron: string | null;
      translation: string | null;
    }> | null;
  };
  hasRichsync: boolean;
  richsync: unknown | null;
  copyrightLine: string | null;
  shareUrl: string | null;
  tracking: { script: string | null; pixel: string | null };
  fetchedAt: string;
  updatedAt: string;
}

export interface LyricsRetrievalResult {
  status: LyricsRetrievalStatus;
  song: LyricsRetrievalSongMeta;
  globalSong?: LyricsRetrievalGlobalSongMeta;
  lyrics?: LyricsRetrievalLyricsBody;
  /** ETag candidate — caller may stamp to response (Last updated time epoch ms). */
  etagSource: string | null;
}

export interface LyricsRetrievalOptions {
  /** Include richsync body. Default false (LongText, opt-in). */
  includeRichsync?: boolean;
}

@Injectable()
export class LyricsRetrievalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look up lyrics state for a channel `Song`.
   *
   * Caller is responsible for permission checks (e.g. console permission guard).
   * This method only gathers data + classifies status.
   *
   * @param songId Song.id
   * @param channelId expected channelId — guards cross-channel access
   * @returns retrieval result with status + selectively populated fields
   */
  async getForSongId(
    songId: number,
    channelId: number,
    options: LyricsRetrievalOptions = {},
  ): Promise<LyricsRetrievalResult> {
    // 권한-우선 query: `findFirst({ where: { id, channelId } })` 로
    // DB 단계에서 채널 격리. 다른 채널 owner 의 song 은 애초에 hydrate 안 됨.
    //
    // 추가로 select 를 좁혀 (a) Song 의 누락된 timestamp 컬럼이 P2020 을
    // 일으키지 않도록 하고, (b) 응답에 노출되는 필드만 가져온다.
    //
    // 에러 메시지는 enumeration 방지를 위해 songId 노출 없이 단순 "Song not found"
    // 로 통일 — id 존재 여부 / 다른 채널 소유 여부 모두 동일 응답.
    const song = await this.prisma.song.findFirst({
      where: { id: songId, channelId },
      select: {
        id: true,
        title: true,
        channelId: true,
        karaokeUrl: true,
        artist: { select: { name: true } },
        globalSong: {
          select: {
            id: true,
            title: true,
            albumArt: true,
            mxmAlbumName: true,
            mxmTrackLengthSec: true,
            primaryIsrc: true,
            mxmInstrumental: true,
            mxmGenresJson: true,
            matcherStatus: true,
            matcherLastAt: true,
            updatedAt: true,
            globalArtist: { select: { canonicalName: true } },
            lyrics: {
              select: {
                body: true,
                bodyKoPron: true,
                bodyTranslation: true,
                bodyTranslationLanguage: true,
                language: true,
                hasSubtitle: true,
                subtitleBody: true,
                hasRichsync: true,
                richsyncBody: true,
                copyrightLine: true,
                shareUrl: true,
                trackingScript: true,
                trackingPixel: true,
                restrictedKr: true,
                fetchedAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    if (!song) {
      throw new NotFoundException('Song not found');
    }

    return this.classify(song, options);
  }

  private classify(
    song: {
      id: number;
      title: string;
      channelId: number;
      karaokeUrl: string | null;
      artist: { name: string };
      globalSong: {
        id: number;
        title: string;
        albumArt: string | null;
        mxmAlbumName: string | null;
        mxmTrackLengthSec: number | null;
        primaryIsrc: string | null;
        mxmInstrumental: boolean;
        mxmGenresJson: unknown;
        matcherStatus: GlobalSongMatcherStatus;
        matcherLastAt: Date | null;
        updatedAt: Date;
        globalArtist: { canonicalName: string };
        lyrics: {
          body: string;
          bodyKoPron: string | null;
          bodyTranslation: string | null;
          bodyTranslationLanguage: string | null;
          language: string | null;
          hasSubtitle: boolean;
          subtitleBody: string | null;
          hasRichsync: boolean;
          richsyncBody: string | null;
          copyrightLine: string | null;
          shareUrl: string | null;
          trackingScript: string | null;
          trackingPixel: string | null;
          restrictedKr: boolean;
          fetchedAt: Date;
          updatedAt: Date;
        } | null;
      } | null;
    },
    options: LyricsRetrievalOptions,
  ): LyricsRetrievalResult {
    const songMeta: LyricsRetrievalSongMeta = {
      id: song.id,
      title: song.title,
      artist: song.artist.name,
      karaokeUrl: song.karaokeUrl ?? null,
    };

    const gs = song.globalSong;
    if (!gs) {
      return { status: 'UNLINKED', song: songMeta, etagSource: null };
    }

    const globalSongMeta: LyricsRetrievalGlobalSongMeta = {
      id: gs.id,
      title: gs.title,
      artist: gs.globalArtist.canonicalName,
      albumArt: gs.albumArt,
      mxmAlbumName: gs.mxmAlbumName,
      mxmTrackLengthSec: gs.mxmTrackLengthSec,
      primaryIsrc: gs.primaryIsrc,
      language: gs.lyrics?.language ?? null,
      genres: normalizeGenres(gs.mxmGenresJson),
    };

    // matcherStatus 우선 분기 — 클라이언트 응답 status 는 lyrics row 상태가
    // 아닌 matcherStatus(authoritative) 를 기반으로 한다.
    switch (gs.matcherStatus) {
      case 'ERROR':
        return {
          status: 'ERROR',
          song: songMeta,
          globalSong: globalSongMeta,
          etagSource: null,
        };
      case 'PENDING':
      case 'UNMATCHED':
      case 'MANUAL_NEEDED':
      case 'IGNORED':
      case 'MATCHED_DUP_OF_OTHER':
        // 콘솔 관점에서 모두 "가사 노출 불가". 별도 status 분리 필요해질 때 추가.
        return {
          status: 'UNMATCHED',
          song: songMeta,
          globalSong: globalSongMeta,
          etagSource: null,
        };
      case 'MATCHED_NO_LYRICS':
        // terminal — mxm 에 가사 자체가 없음. PENDING_LYRICS 와 분리해 무한 폴링 방지.
        return {
          status: 'NO_LYRICS',
          song: songMeta,
          globalSong: globalSongMeta,
          etagSource: null,
        };
      case 'MATCHED_INSTRUMENTAL':
        // matcherStatus 가 authoritative — lyrics row 유무 무관.
        return {
          status: 'INSTRUMENTAL',
          song: songMeta,
          globalSong: globalSongMeta,
          etagSource: null,
        };
      case 'MATCHED_RESTRICTED':
        // matcherStatus 가 authoritative — lyrics row / restrictedKr 컬럼 유무 무관.
        // body 절대 비노출.
        return {
          status: 'RESTRICTED',
          song: songMeta,
          globalSong: globalSongMeta,
          etagSource: composeEtagSource(
            gs.updatedAt,
            gs.matcherLastAt,
            gs.lyrics?.updatedAt ?? null,
          ),
        };
      case 'MATCHED':
        // 아래 instrumental / lyrics 분기로 진행
        break;
    }

    // matcherStatus = MATCHED — legacy 데이터에서 mxmInstrumental flag 가
    // matcherStatus 와 분리되어 있을 수 있으므로 여기서 한 번 더 체크.
    if (gs.mxmInstrumental) {
      return {
        status: 'INSTRUMENTAL',
        song: songMeta,
        globalSong: globalSongMeta,
        etagSource: null,
      };
    }

    const lyrics = gs.lyrics;
    if (!lyrics) {
      return {
        status: 'PENDING_LYRICS',
        song: songMeta,
        globalSong: globalSongMeta,
        etagSource: null,
      };
    }

    if (lyrics.restrictedKr) {
      // 컬럼 단위 KR 제한 — matcherStatus 가 MATCHED 이지만 lyrics row 가 KR 제한을
      // 표시. body 비표시.
      return {
        status: 'RESTRICTED',
        song: songMeta,
        globalSong: globalSongMeta,
        etagSource: composeEtagSource(
          gs.updatedAt,
          gs.matcherLastAt,
          lyrics.updatedAt,
        ),
      };
    }

    const lrcLines = lyrics.hasSubtitle ? parseLrc(lyrics.subtitleBody) : [];
    const koPronLines = alignAuxiliaryLines({
      auxiliaryBody: lyrics.bodyKoPron,
      lyricsBody: lyrics.body,
      lrcLines,
    });
    const translationLines = alignAuxiliaryLines({
      auxiliaryBody: lyrics.bodyTranslation,
      lyricsBody: lyrics.body,
      lrcLines,
    });
    const syncedLines = lrcLines.map((line, index) => ({
      ...line,
      koPron: koPronLines?.[index] ?? null,
      translation: translationLines?.[index] ?? null,
    }));
    const richsyncPayload = (() => {
      if (
        !options.includeRichsync ||
        !lyrics.hasRichsync ||
        !lyrics.richsyncBody
      ) {
        return null;
      }
      try {
        return JSON.parse(lyrics.richsyncBody) as unknown;
      } catch {
        return null;
      }
    })();

    return {
      status: 'OK',
      song: songMeta,
      globalSong: globalSongMeta,
      lyrics: {
        body: lyrics.body,
        bodyKoPron: lyrics.bodyKoPron,
        bodyTranslation: lyrics.bodyTranslation,
        bodyTranslationLanguage: lyrics.bodyTranslationLanguage,
        language: lyrics.language,
        synced: {
          format: lyrics.hasSubtitle && syncedLines.length > 0 ? 'lrc' : null,
          lines:
            lyrics.hasSubtitle && syncedLines.length > 0 ? syncedLines : null,
        },
        hasRichsync: lyrics.hasRichsync,
        richsync: richsyncPayload,
        copyrightLine: lyrics.copyrightLine,
        shareUrl: lyrics.shareUrl,
        tracking: {
          script: lyrics.trackingScript,
          pixel: lyrics.trackingPixel,
        },
        fetchedAt: lyrics.fetchedAt.toISOString(),
        updatedAt: lyrics.updatedAt.toISOString(),
      },
      etagSource: composeEtagSource(
        gs.updatedAt,
        gs.matcherLastAt,
        lyrics.updatedAt,
      ),
    };
  }
}

function alignAuxiliaryLines({
  auxiliaryBody,
  lyricsBody,
  lrcLines,
}: {
  auxiliaryBody: string | null;
  lyricsBody: string;
  lrcLines: Array<{ text: string }>;
}): Array<string | null> | null {
  if (!auxiliaryBody || lrcLines.length === 0) return null;

  const auxiliaryLines = auxiliaryBody.split(/\r?\n/);
  if (auxiliaryLines.length === lrcLines.length) return auxiliaryLines;

  const bodyLines = lyricsBody.split(/\r?\n/);
  if (bodyLines.length !== auxiliaryLines.length) return null;

  const compactPairs = bodyLines
    .map((bodyLine, index) => ({
      bodyLine,
      auxiliaryLine: auxiliaryLines[index],
    }))
    .filter(({ bodyLine }) => normalizeLyricLine(bodyLine).length > 0);

  if (compactPairs.length === lrcLines.length) {
    return compactPairs.map(({ auxiliaryLine }) => auxiliaryLine);
  }

  const aligned: Array<string | null> = [];
  let cursor = 0;
  for (const lrcLine of lrcLines) {
    const target = normalizeLyricLine(lrcLine.text);
    if (!target) {
      aligned.push(null);
      continue;
    }

    let matchedIndex = -1;
    for (let index = cursor; index < compactPairs.length; index += 1) {
      if (normalizeLyricLine(compactPairs[index].bodyLine) === target) {
        matchedIndex = index;
        break;
      }
    }
    if (matchedIndex < 0) return null;

    aligned.push(compactPairs[matchedIndex].auxiliaryLine);
    cursor = matchedIndex + 1;
  }

  return aligned.length === lrcLines.length ? aligned : null;
}

function normalizeLyricLine(value: string): string {
  return value
    .replace(/\u200b/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
