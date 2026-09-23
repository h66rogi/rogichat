import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KoreanPronunciationService } from './korean-pronunciation.service';
import { MusixmatchClient, MusixmatchNotFoundError } from './musixmatch.client';
import { MusixmatchRedisService } from './musixmatch-redis.service';
import { MusixmatchQuotaExceededError } from './musixmatch-quota.service';
import {
  MxmLyricsTranslationGetBody,
  MxmLyricsTranslationLine,
} from './dto/musixmatch.dto';

/**
 * Fetch and persist Musixmatch lyrics + LRC subtitle for a GlobalSong.
 *
 * - Body via track.lyrics.get
 * - LRC via track.subtitle.get (only when matcher said has_subtitles=1)
 * - Richsync deferred to Phase A2 (added when overlay/karaoke spec lands)
 *
 * Stores into `global_song_lyrics` (1:1 with GlobalSong). Region restriction:
 * mxm flags `restricted=1` on the lyrics object when the response is blocked
 * for the requesting country/territory; we capture this and surface
 * `MATCHED_RESTRICTED` upstream so the matcher can finalize the right
 * status (per spec Section 10.3 — KR-only display, restricted body never
 * served).
 *
 * Cache strategy (spec Section 7):
 *   - DB row is the 1st-class persistence (영구 저장 unless admin clears)
 *   - Redis hot cache (24h) is for read-path speed only
 */
@Injectable()
export class MusixmatchLyricsService {
  private readonly logger = new Logger(MusixmatchLyricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MusixmatchClient,
    private readonly redis: MusixmatchRedisService,
    private readonly koPronunciation: KoreanPronunciationService,
  ) {}

  /**
   * Fetch lyrics (and LRC subtitle when available) for a matched track and
   * upsert the GlobalSongLyrics row.
   */
  async fetchAndStore(
    globalSongId: number,
    mxmTrackId: number,
    hasSubtitles: boolean,
    mode: 'normal' | 'backfill',
  ): Promise<'STORED' | 'NO_LYRICS' | 'RESTRICTED_KR' | 'INSTRUMENTAL'> {
    // Fetched up-front so we can use the GlobalSong title to correct mxm's
    // lyrics_language when it misclassifies romanized Korean as some
    // unrelated Latin language (et / lt / etc.).
    const gsForLang = await this.prisma.globalSong.findUnique({
      where: { id: globalSongId },
      select: { title: true },
    });

    let lyricsResp;
    try {
      lyricsResp = await this.client.trackLyricsGet(
        { track_id: mxmTrackId },
        { mode },
      );
    } catch (err) {
      if (err instanceof MusixmatchNotFoundError) {
        return 'NO_LYRICS';
      }
      // quota / breaker / transport failures bubble — caller will retry
      throw err;
    }

    const lyrics = lyricsResp?.lyrics;
    if (!lyrics) {
      return 'NO_LYRICS';
    }
    if (lyrics.instrumental === 1) {
      return 'INSTRUMENTAL';
    }
    if (lyrics.restricted === 1) {
      // KR is the only target market. We cannot determine per-country
      // restriction directly from this response, but `restricted=1` means
      // the lyrics are not licensed for distribution from our request
      // context. Capture and surface RESTRICTED so the upstream marks
      // status accordingly without storing the body.
      await this.upsertRestrictedRow(globalSongId, mxmTrackId, lyrics);
      return 'RESTRICTED_KR';
    }
    if (!lyrics.lyrics_body || lyrics.lyrics_body.length === 0) {
      return 'NO_LYRICS';
    }
    // Defensive: mxm response shape has been observed to vary. Refuse to
    // persist a "undefined" externalId from String(undefined).
    if (
      typeof lyrics.lyrics_id !== 'number' ||
      !Number.isFinite(lyrics.lyrics_id)
    ) {
      this.logger.warn(
        `globalSongId=${globalSongId} mxm lyrics body present but lyrics_id missing; treating as NO_LYRICS`,
      );
      return 'NO_LYRICS';
    }

    let subtitleBody: string | null = null;
    let subtitleId: string | null = null;
    let subtitleLength: number | null = null;
    if (hasSubtitles) {
      try {
        const subResp = await this.client.trackSubtitleGet(
          { track_id: mxmTrackId },
          { mode },
        );
        const sub = subResp?.subtitle;
        if (sub && sub.restricted !== 1) {
          subtitleBody = sub.subtitle_body ?? null;
          subtitleId = sub.subtitle_id ? String(sub.subtitle_id) : null;
          subtitleLength = sub.subtitle_length ?? null;
        }
      } catch (err) {
        if (err instanceof MusixmatchNotFoundError) {
          // subtitle missing — body still stored
        } else if (err instanceof MusixmatchQuotaExceededError) {
          // budget tight — defer subtitle (body still stored)
          this.logger.warn(
            `subtitle fetch skipped due to quota for globalSongId=${globalSongId}`,
          );
        } else {
          throw err;
        }
      }
    }

    const correctedLanguage = inferCorrectedLanguage(
      gsForLang?.title ?? null,
      lyrics.lyrics_language ?? null,
    );
    const translation = await this.fetchKoreanTranslationIfNeeded(
      globalSongId,
      mxmTrackId,
      correctedLanguage,
      mode,
    );

    await this.prisma.globalSongLyrics.upsert({
      where: { globalSongId },
      create: {
        globalSongId,
        source: 'MUSIXMATCH',
        externalId: String(lyrics.lyrics_id),
        body: lyrics.lyrics_body,
        language: correctedLanguage,
        bodyTranslation: translation?.body ?? null,
        bodyTranslationLanguage: translation?.language ?? null,
        bodyTranslationAt: translation ? new Date() : null,
        hasSubtitle: !!subtitleBody,
        subtitleId,
        subtitleBody,
        subtitleLength,
        hasRichsync: false,
        copyrightLine: lyrics.lyrics_copyright ?? null,
        trackingScript: lyrics.script_tracking_url ?? null,
        trackingPixel: lyrics.pixel_tracking_url ?? null,
        shareUrl: lyrics.backlink_url ?? null,
        restrictedKr: false,
        restrictionsRaw: undefined,
        fetchedAt: new Date(),
      },
      update: {
        externalId: String(lyrics.lyrics_id),
        body: lyrics.lyrics_body,
        language: correctedLanguage,
        bodyTranslation: translation?.body ?? null,
        bodyTranslationLanguage: translation?.language ?? null,
        bodyTranslationAt: translation ? new Date() : null,
        hasSubtitle: !!subtitleBody,
        subtitleId,
        subtitleBody,
        subtitleLength,
        copyrightLine: lyrics.lyrics_copyright ?? null,
        trackingScript: lyrics.script_tracking_url ?? null,
        trackingPixel: lyrics.pixel_tracking_url ?? null,
        shareUrl: lyrics.backlink_url ?? null,
        restrictedKr: false,
        restrictionsRaw: Prisma.JsonNull,
        fetchedAt: new Date(),
      },
    });

    await this.redis.invalidateLyrics(globalSongId);

    // Phase A1f — auto-generate Korean phonetic spelling for non-Korean
    // lyrics (currently Japanese only). Best-effort: any failure leaves
    // bodyKoPron NULL and admin can regenerate manually.
    if (this.koPronunciation.isSupportedLanguage(correctedLanguage)) {
      void this.maybeGenerateKoPronunciation(
        globalSongId,
        lyrics.lyrics_body,
        correctedLanguage,
      );
    }
    return 'STORED';
  }

  /**
   * Fire-and-forget pronunciation generation. Runs after the main lyrics
   * row is saved so any LLM failure (timeout, quota, etc.) never blocks
   * the matching pipeline. Caller does NOT await this — the column will
   * fill in moments later, or stay NULL on failure.
   */
  private async maybeGenerateKoPronunciation(
    globalSongId: number,
    body: string,
    language: string,
  ): Promise<void> {
    try {
      const pron = await this.koPronunciation.transliterate(body, language);
      if (!pron) return;
      await this.prisma.globalSongLyrics.update({
        where: { globalSongId },
        data: {
          bodyKoPron: pron,
          bodyKoPronAt: new Date(),
        },
      });
      await this.redis.invalidateLyrics(globalSongId);
    } catch (error) {
      this.logger.warn(
        `Korean pronunciation save failed for globalSongId=${globalSongId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  private async fetchKoreanTranslationIfNeeded(
    globalSongId: number,
    mxmTrackId: number,
    language: string | null,
    mode: 'normal' | 'backfill',
  ): Promise<{ body: string; language: string } | null> {
    if (!language || language.toLowerCase() === 'ko') {
      return null;
    }
    try {
      const resp = await this.client.trackLyricsTranslationGet(
        { track_id: mxmTrackId, selected_language: 'ko' },
        { mode },
      );
      const body = extractTranslationBody(resp);
      return body ? { body, language: 'ko' } : null;
    } catch (err) {
      if (err instanceof MusixmatchNotFoundError) {
        return null;
      }
      if (err instanceof MusixmatchQuotaExceededError) {
        this.logger.warn(
          `translation fetch skipped due to quota for globalSongId=${globalSongId}`,
        );
        return null;
      }
      this.logger.warn(
        `translation fetch failed for globalSongId=${globalSongId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return null;
    }
  }

  private async upsertRestrictedRow(
    globalSongId: number,
    mxmTrackId: number,
    raw: unknown,
  ): Promise<void> {
    void mxmTrackId;
    // CRITICAL: clear ALL body-bearing fields so a previously-unrestricted
    // match flipping to restricted=1 cannot leave subtitle/richsync text on
    // the row (spec Section 10.3 KR-only enforcement).
    await this.prisma.globalSongLyrics.upsert({
      where: { globalSongId },
      create: {
        globalSongId,
        source: 'MUSIXMATCH',
        body: '',
        restrictedKr: true,
        restrictionsRaw: raw as Prisma.InputJsonValue,
        fetchedAt: new Date(),
      },
      update: {
        body: '',
        externalId: null,
        language: null,
        bodyTranslation: null,
        bodyTranslationLanguage: null,
        bodyTranslationAt: null,
        hasSubtitle: false,
        subtitleId: null,
        subtitleBody: null,
        subtitleLength: null,
        hasRichsync: false,
        richsyncId: null,
        richsyncBody: null,
        copyrightLine: null,
        trackingScript: null,
        trackingPixel: null,
        shareUrl: null,
        restrictedKr: true,
        restrictionsRaw: raw as Prisma.InputJsonValue,
        fetchedAt: new Date(),
      },
    });
    await this.redis.invalidateLyrics(globalSongId);
  }
}

export function extractTranslationBody(
  resp: MxmLyricsTranslationGetBody | null | undefined,
): string | null {
  const translated = resp?.lyrics?.lyrics_translated;
  if (translated?.restricted !== 1 && translated?.locked !== 1) {
    const translatedBody = translated?.lyrics_body?.trim();
    if (translatedBody) return translatedBody;
  }

  const translation = resp?.lyrics_translation;
  if (!translation) return null;

  const wholeBody = translation.lyrics_translation_body?.trim();
  if (wholeBody) return wholeBody;

  const lines = translation.translation_list
    ?.map((entry) => {
      const item = getTranslationLine(entry);
      return item?.description?.trim() ?? '';
    })
    .filter((line) => line.length > 0);

  return lines && lines.length > 0 ? lines.join('\n') : null;
}

function getTranslationLine(
  entry:
    | MxmLyricsTranslationLine
    | { translation?: MxmLyricsTranslationLine | null }
    | null
    | undefined,
): MxmLyricsTranslationLine | undefined {
  if (!entry) return undefined;
  if ('translation' in entry) return entry.translation ?? undefined;
  return entry as MxmLyricsTranslationLine;
}

/**
 * Languages mxm regularly defaults to when its detector can't tell what
 * language a Latin-script body is. K-pop / J-pop tracks released with
 * romanized lyrics frequently get tagged as Estonian / Lithuanian / etc.
 * If we see one of these AND the GlobalSong title contains Hangul or
 * Kana, we override to the title's actual language so admin and the
 * console UI don't show "Estonian" for a Korean ballad.
 */
const SUSPICIOUS_LATIN_LANGS: ReadonlySet<string> = new Set([
  'et', // Estonian
  'lt', // Lithuanian
  'lv', // Latvian
  'fi', // Finnish
  'mt', // Maltese
  'is', // Icelandic
  'sw', // Swahili
  'eu', // Basque
  'ga', // Irish
  'mk', // Macedonian
  'sq', // Albanian
  'cy', // Welsh
  'so', // Somali
]);

// Unicode ranges:
//   Hangul Syllables: U+AC00 – U+D7AF
//   Hiragana + Katakana: U+3040 – U+30FF
const HANGUL_RE = /[가-힯]/;
const KANA_RE = /[぀-ヿ]/;

function inferCorrectedLanguage(
  title: string | null,
  mxmLang: string | null,
): string | null {
  if (!mxmLang) return null;
  const lc = mxmLang.toLowerCase();
  if (!SUSPICIOUS_LATIN_LANGS.has(lc)) return mxmLang;
  if (!title) return mxmLang;
  if (HANGUL_RE.test(title)) return 'ko';
  if (KANA_RE.test(title)) return 'ja';
  return mxmLang;
}
