import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';
import {
  GlobalSongMatcherService,
  MatchGlobalSongResult,
} from './global-song-matcher.service';
import { LlmCategoryDifficultyJudgeService } from './llm-category-difficulty-judge.service';
import { normalizeForSearch } from '../song/utils/search-normalize';
import { ChannelMusicbookSettingsService } from '../channel/channel-musicbook-settings.service';

/**
 * `!노래책추가` 채팅 명령으로 들어온 곡을 채널 노래책에 추가.
 *
 * 거절 정책 (모두 throw):
 *   - 매칭 실패 → BadRequestException(code: NO_MATCH)
 *   - confidence 미달 (autoAcceptable=false) → BadRequestException(code: LOW_CONFIDENCE)
 *   - 같은 globalSongId 가 채널 노래책에 이미 등록 → ConflictException(code: ALREADY_IN_SONGBOOK)
 *
 * 권한 검증은 호출자(controller) 책임 — 여기서는 channelId 가 이미 검증된 상태로 들어옴.
 *
 * 트랜잭션 단위: Artist findFirst+create + Song create + (옵션) SongCategory create.
 * Artist 는 schema 에 unique 없음 (channelId + name) — 같은 채팅 dispatch 의 streamMessageId
 * dedup 으로 동일 명령 중복은 차단되므로 race 시 같은 이름 row 두 개 생성 위험은 사실상 0.
 */
@Injectable()
export class SongbookAddService {
  private readonly logger = new Logger(SongbookAddService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matcher: GlobalSongMatcherService,
    private readonly judge: LlmCategoryDifficultyJudgeService,
    private readonly metrics: MetricsService,
    private readonly cacheTracker: CacheKeyTrackingService,
    private readonly musicbookSettingsService: ChannelMusicbookSettingsService,
  ) {}

  async add(input: {
    channelId: number;
    query: string;
    requesterUserId: number;
  }): Promise<SongbookAddResult> {
    const t0 = Date.now();
    const matched = await this.matcher.matchGlobalSong({
      channelId: input.channelId,
      rawQuery: input.query,
    });
    if (!matched) {
      this.metrics.songbookAddLatencySeconds
        .labels({ matched: 'false' })
        .observe((Date.now() - t0) / 1000);
      throw new BadRequestException({ code: 'NO_MATCH' });
    }
    if (!matched.autoAcceptable) {
      this.metrics.songbookAddLatencySeconds
        .labels({ matched: 'false' })
        .observe((Date.now() - t0) / 1000);
      throw new BadRequestException({
        code: 'LOW_CONFIDENCE',
        confidence: matched.confidence,
        candidateTitle: matched.globalSong.title,
        candidateArtist: matched.globalSong.canonicalArtistName,
      });
    }

    // Fast-path pre-check — Conflict 케이스에서 judge LLM 비용 절약.
    // race window 는 tx 내 재검사 + (schema unique 도입 후) P2002 catch 가 막는다.
    const preExisting = await this.prisma.song.findFirst({
      where: {
        channelId: input.channelId,
        globalSongId: matched.globalSong.id,
      },
      select: {
        id: true,
        title: true,
        artist: { select: { name: true } },
      },
    });
    if (preExisting) {
      throw new ConflictException({
        code: 'ALREADY_IN_SONGBOOK',
        title: preExisting.title,
        artistName: preExisting.artist.name,
      });
    }

    const judgement = await this.judge.decide({
      channelId: input.channelId,
      globalSongId: matched.globalSong.id,
    });
    if (judgement.llmCalled) {
      this.metrics.songbookAddLlmJudgeCallsTotal.inc({
        matched_category: judgement.categoryId !== null ? 'true' : 'false',
        used_avg_difficulty: judgement.usedAvgDifficulty ? 'true' : 'false',
      });
    }
    const useProficiencyAsPrimary =
      await this.musicbookSettingsService.usesProficiencyAsPrimary(
        input.channelId,
      );

    // tx 안 재검사로 pre-check ~ INSERT 사이 race 방어. schema 에
    // `Song(channelId, globalSongId)` unique 도입 후엔 P2002 catch 가 진짜 race 까지 막음.
    const created = await this.prisma
      .$transaction(async (tx) => {
        const existing = await tx.song.findFirst({
          where: {
            channelId: input.channelId,
            globalSongId: matched.globalSong.id,
          },
          select: {
            id: true,
            title: true,
            artist: { select: { name: true } },
          },
        });
        if (existing) {
          throw new ConflictException({
            code: 'ALREADY_IN_SONGBOOK',
            title: existing.title,
            artistName: existing.artist.name,
          });
        }

        const existingArtist = await tx.artist.findFirst({
          where: {
            channelId: input.channelId,
            name: matched.globalSong.canonicalArtistName,
          },
          select: { id: true, name: true },
        });
        const artist =
          existingArtist ??
          (await tx.artist.create({
            data: {
              channelId: input.channelId,
              name: matched.globalSong.canonicalArtistName,
              nameSearchable: normalizeForSearch(
                matched.globalSong.canonicalArtistName,
              ),
            },
            select: { id: true, name: true },
          }));

        const song = await tx.song.create({
          data: {
            channelId: input.channelId,
            title: matched.globalSong.title,
            titleSearchable: normalizeForSearch(matched.globalSong.title),
            artistId: artist.id,
            globalSongId: matched.globalSong.id,
            difficulty: judgement.difficulty,
            proficiency: useProficiencyAsPrimary
              ? judgement.difficulty
              : undefined,
          },
          select: { id: true, title: true },
        });

        if (judgement.categoryId !== null) {
          await tx.songCategory.create({
            data: { songId: song.id, categoryId: judgement.categoryId },
          });
        }

        return { song, artist };
      })
      .catch((err) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // unique 도입 후 (Song.channelId+globalSongId) 동시 INSERT race 시 발생.
          // 한 쪽은 성공, 다른 쪽은 P2002 → ALREADY_IN_SONGBOOK 으로 사용자에게 동일한 결과 노출.
          throw new ConflictException({
            code: 'ALREADY_IN_SONGBOOK',
            title: matched.globalSong.title,
            artistName: matched.globalSong.canonicalArtistName,
          });
        }
        throw err;
      });

    this.metrics.songbookAddLatencySeconds
      .labels({ matched: 'true' })
      .observe((Date.now() - t0) / 1000);

    // tx.song.create 가 channelId 에 새 곡 INSERT — song list 응답 stale 해소.
    await this.cacheTracker.clearChannelSafe(
      input.channelId,
      'songbookAdd',
    );

    this.logger.log(
      `Songbook add: channel=${input.channelId} song=${created.song.id} ` +
        `globalSong=${matched.globalSong.id} difficulty=${judgement.difficulty} ` +
        `categoryId=${judgement.categoryId ?? 'null'} ` +
        `confidence=${matched.confidence.toFixed(2)} requester=${input.requesterUserId}`,
    );

    return {
      songId: created.song.id,
      globalSongId: matched.globalSong.id,
      title: created.song.title,
      artistName: created.artist.name,
      difficulty: judgement.difficulty,
      categoryId: judgement.categoryId,
      confidence: matched.confidence,
      matchTrace: matched.trace,
    };
  }

  /**
   * dry-run preview — admin 테스트 페이지에서 매칭 + judge 결과만 보고 실제 INSERT 는 하지 않는다.
   *
   * autoAcceptable 미달도 결과를 그대로 반환 (admin이 confidence 진단 가능하도록).
   * judge 는 실제 LLM/DB 호출이 발생 (비용 측정 의도). matcher 도 동일.
   */
  async preview(input: {
    channelId: number;
    query: string;
  }): Promise<SongbookAddPreview> {
    const matched = await this.matcher.matchGlobalSong({
      channelId: input.channelId,
      rawQuery: input.query,
    });
    if (!matched) {
      return { matched: false };
    }

    const existing = await this.prisma.song.findFirst({
      where: {
        channelId: input.channelId,
        globalSongId: matched.globalSong.id,
      },
      select: {
        id: true,
        title: true,
        artist: { select: { name: true } },
      },
    });

    const judgement = await this.judge.decide({
      channelId: input.channelId,
      globalSongId: matched.globalSong.id,
    });

    return {
      matched: true,
      globalSong: matched.globalSong,
      confidence: matched.confidence,
      autoAcceptable: matched.autoAcceptable,
      alreadyInSongbook: existing
        ? {
            songId: existing.id,
            title: existing.title,
            artistName: existing.artist.name,
          }
        : null,
      judgement: {
        categoryId: judgement.categoryId,
        difficulty: judgement.difficulty,
        reasoning: judgement.reasoning,
      },
      matchTrace: matched.trace,
    };
  }
}

export type SongbookAddPreview =
  | { matched: false }
  | {
      matched: true;
      globalSong: { id: number; title: string; canonicalArtistName: string };
      confidence: number;
      autoAcceptable: boolean;
      alreadyInSongbook: {
        songId: number;
        title: string;
        artistName: string;
      } | null;
      judgement: {
        categoryId: number | null;
        difficulty: number;
        reasoning?: string;
      };
      matchTrace: MatchGlobalSongResult['trace'];
    };

export interface SongbookAddResult {
  songId: number;
  globalSongId: number;
  title: string;
  artistName: string;
  difficulty: number;
  categoryId: number | null;
  confidence: number;
  matchTrace: MatchGlobalSongResult['trace'];
}
