import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KoreanPronunciationService } from './korean-pronunciation.service';
import { extractTranslationBody } from './musixmatch-lyrics.service';
import {
  MusixmatchClient,
  MusixmatchNotFoundError,
} from './musixmatch.client';
import { MusixmatchQuotaExceededError } from './musixmatch-quota.service';
import { MusixmatchRedisService } from './musixmatch-redis.service';

export interface LyricsExtrasBackfillOptions {
  language?: string;
  limit?: number;
  dryRun?: boolean;
  includeTranslation?: boolean;
  includePronunciation?: boolean;
}

export interface LyricsExtrasBackfillResult {
  language: string;
  dryRun: boolean;
  picked: number;
  processed: number;
  translationUpdated: number;
  translationUnavailable: number;
  pronunciationUpdated: number;
  pronunciationUnavailable: number;
  skipped: number;
  errors: number;
  haltReason: 'quota' | null;
  items: Array<{
    globalSongId: number;
    translation: 'updated' | 'unavailable' | 'skipped' | 'dry-run';
    pronunciation: 'updated' | 'unavailable' | 'skipped' | 'dry-run';
    error?: string;
  }>;
}

export interface LyricsExtrasCoverageResult {
  language: string;
  total: number;
  withPronunciation: number;
  pronunciationAttempted: number;
  pronunciationMissing: number;
  withTranslation: number;
  translationAttempted: number;
  translationNotAttempted: number;
}

type Candidate = Prisma.GlobalSongLyricsGetPayload<{
  include: { globalSong: { select: { mxmTrackId: true } } };
}>;

/**
 * Backfills auxiliary lyrics fields for already-stored Musixmatch lyrics.
 *
 * The normal Musixmatch backfill cron only processes PENDING GlobalSongs. It
 * does not revisit existing lyrics rows when a new auxiliary field such as
 * Korean translation is introduced. This service is intentionally batch-sized
 * and internal-key gated by the controller so production runs can advance
 * within Musixmatch quota without ad-hoc SQL/scripts.
 */
@Injectable()
export class LyricsExtrasBackfillService {
  private readonly logger = new Logger(LyricsExtrasBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MusixmatchClient,
    private readonly koPronunciation: KoreanPronunciationService,
    private readonly redis: MusixmatchRedisService,
  ) {}

  async run(
    options: LyricsExtrasBackfillOptions = {},
  ): Promise<LyricsExtrasBackfillResult> {
    const language = normalizeLanguage(options.language);
    const limit = clampLimit(options.limit);
    const includeTranslation = options.includeTranslation !== false;
    const includePronunciation = options.includePronunciation !== false;
    const dryRun = options.dryRun === true;

    const candidates = await this.pickCandidates({
      language,
      limit,
      includeTranslation,
      includePronunciation,
    });

    const result: LyricsExtrasBackfillResult = {
      language,
      dryRun,
      picked: candidates.length,
      processed: 0,
      translationUpdated: 0,
      translationUnavailable: 0,
      pronunciationUpdated: 0,
      pronunciationUnavailable: 0,
      skipped: 0,
      errors: 0,
      haltReason: null,
      items: [],
    };

    for (const row of candidates) {
      const item: LyricsExtrasBackfillResult['items'][number] = {
        globalSongId: row.globalSongId,
        translation: 'skipped',
        pronunciation: 'skipped',
      };

      if (dryRun) {
        item.translation = needsTranslation(row) ? 'dry-run' : 'skipped';
        item.pronunciation = needsPronunciation(row) ? 'dry-run' : 'skipped';
        result.items.push(item);
        result.processed += 1;
        continue;
      }

      try {
        const data: Prisma.GlobalSongLyricsUpdateInput = {};

        if (includeTranslation && needsTranslation(row)) {
          const translation = await this.fetchKoreanTranslation(row);
          if (translation) {
            data.bodyTranslation = translation;
            data.bodyTranslationLanguage = 'ko';
            data.bodyTranslationAt = new Date();
            result.translationUpdated += 1;
            item.translation = 'updated';
          } else {
            data.bodyTranslationAt = new Date();
            result.translationUnavailable += 1;
            item.translation = 'unavailable';
          }
        }

        if (includePronunciation && needsPronunciation(row)) {
          const pron = await this.koPronunciation.transliterate(
            row.body,
            row.language ?? '',
          );
          data.bodyKoPron = pron ?? '';
          data.bodyKoPronAt = new Date();
          if (pron) {
            result.pronunciationUpdated += 1;
            item.pronunciation = 'updated';
          } else {
            result.pronunciationUnavailable += 1;
            item.pronunciation = 'unavailable';
          }
        }

        if (Object.keys(data).length === 0) {
          result.skipped += 1;
        } else {
          await this.prisma.globalSongLyrics.update({
            where: { globalSongId: row.globalSongId },
            data,
          });
          await this.redis.invalidateLyrics(row.globalSongId);
        }

        result.processed += 1;
      } catch (error) {
        if (error instanceof MusixmatchQuotaExceededError) {
          result.haltReason = 'quota';
          result.items.push(item);
          break;
        }
        result.errors += 1;
        item.error = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `lyrics extras backfill failed globalSongId=${row.globalSongId}: ${item.error}`,
        );
      }

      result.items.push(item);
    }

    return result;
  }

  async getCoverage(languageInput?: string): Promise<LyricsExtrasCoverageResult> {
    const language = normalizeLanguage(languageInput);
    const [
      total,
      withPronunciation,
      pronunciationAttempted,
      pronunciationMissing,
      withTranslation,
      translationAttempted,
      translationNotAttempted,
    ] = await Promise.all([
      this.prisma.globalSongLyrics.count({ where: { language } }),
      this.prisma.globalSongLyrics.count({
        where: {
          language,
          AND: [{ bodyKoPron: { not: null } }, { bodyKoPron: { not: '' } }],
        },
      }),
      this.prisma.globalSongLyrics.count({
        where: { language, bodyKoPronAt: { not: null } },
      }),
      this.prisma.globalSongLyrics.count({
        where: {
          language,
          OR: [{ bodyKoPronAt: null }, { bodyKoPron: null }, { bodyKoPron: '' }],
        },
      }),
      this.prisma.globalSongLyrics.count({
        where: {
          language,
          AND: [
            { bodyTranslation: { not: null } },
            { bodyTranslation: { not: '' } },
          ],
        },
      }),
      this.prisma.globalSongLyrics.count({
        where: { language, bodyTranslationAt: { not: null } },
      }),
      this.prisma.globalSongLyrics.count({
        where: { language, bodyTranslationAt: null },
      }),
    ]);

    return {
      language,
      total,
      withPronunciation,
      pronunciationAttempted,
      pronunciationMissing,
      withTranslation,
      translationAttempted,
      translationNotAttempted,
    };
  }

  private pickCandidates(params: {
    language: string;
    limit: number;
    includeTranslation: boolean;
    includePronunciation: boolean;
  }): Promise<Candidate[]> {
    const missing: Prisma.GlobalSongLyricsWhereInput[] = [];
    if (params.includeTranslation) {
      missing.push({ bodyTranslationAt: null });
    }
    if (
      params.includePronunciation &&
      this.koPronunciation.isSupportedLanguage(params.language)
    ) {
      missing.push({
        OR: [{ bodyKoPronAt: null }, { bodyKoPron: null }, { bodyKoPron: '' }],
      });
    }
    if (missing.length === 0) return Promise.resolve([]);

    return this.prisma.globalSongLyrics.findMany({
      where: {
        language: params.language,
        restrictedKr: false,
        body: { not: '' },
        globalSong: { mxmTrackId: { not: null } },
        OR: missing,
      },
      include: { globalSong: { select: { mxmTrackId: true } } },
      orderBy: [{ updatedAt: 'asc' }, { globalSongId: 'asc' }],
      take: params.limit,
    });
  }

  private async fetchKoreanTranslation(row: Candidate): Promise<string | null> {
    const trackId = row.globalSong.mxmTrackId;
    if (!trackId) return null;

    try {
      const resp = await this.client.trackLyricsTranslationGet(
        { track_id: trackId, selected_language: 'ko' },
        { mode: 'backfill' },
      );
      return extractTranslationBody(resp);
    } catch (error) {
      if (error instanceof MusixmatchNotFoundError) {
        return null;
      }
      throw error;
    }
  }
}

function needsTranslation(row: Candidate): boolean {
  return row.bodyTranslationAt === null;
}

function needsPronunciation(row: Candidate): boolean {
  return row.bodyKoPronAt === null || !row.bodyKoPron;
}

function normalizeLanguage(value: string | undefined): string {
  const normalized = (value ?? 'ja').trim().toLowerCase();
  return normalized.length > 0 ? normalized : 'ja';
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) return 50;
  return Math.max(1, Math.min(200, Math.floor(value)));
}
