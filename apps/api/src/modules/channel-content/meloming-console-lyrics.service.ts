import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import type { ConsoleCredentials } from './meloming-live-session.service.js';
import { MelomingLyricsQuotaService } from './meloming-lyrics-quota.service.js';
import { LyricsRetrievalService, type LyricsRetrievalResult } from './upstream/global-song/musixmatch/lyrics-retrieval.service.js';
import { hasExposableLyrics } from './upstream/lyrics-content.util.js';

/** The original ConsoleLyricsService read path with Rogichat's room UUID mapping. */
@Injectable()
export class MelomingConsoleLyricsService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
    @Inject(MelomingLyricsQuotaService) private readonly quota: MelomingLyricsQuotaService,
  ) {}

  async getLyrics(credentials: SessionCredentials | ConsoleCredentials, params: {
    identifier: string; songId: number; liveSessionId?: number; songRequestId?: number; includeRichsync: boolean;
  }) {
    if (params.identifier !== 'hurogi' && params.identifier !== '1') throw new ApiError('NOT_FOUND', 404);
    const { roomId, result } = await this.transactions.read(async tx => {
      const roomId = 'consoleToken' in credentials
        ? (await this.repository.requireConsoleToken(tx, credentials.consoleToken)).roomId
        : await this.repository.requireOwner(tx, (await this.auth.require(tx, credentials, true)).userId);
      const result = await new LyricsRetrievalService(tx.prisma).getForSongId(
        params.songId, roomId, { includeRichsync: params.includeRichsync });
      return { roomId, result };
    });
    const quota = hasExposableLyrics(result)
      ? await this.quota.consumeForLyrics({ roomId,
          ...(params.liveSessionId !== undefined ? { liveSessionId: params.liveSessionId } : {}),
          ...(params.songRequestId !== undefined ? { songRequestId: params.songRequestId } : {}),
          songId: params.songId })
      : null;
    if (quota && !quota.allowed) {
      return { payload: { status: 'QUOTA_EXCEEDED' as const, song: result.song,
        globalSong: result.globalSong, quota }, etagSource: null };
    }
    return { payload: this.toResponse(result, quota ?? undefined), etagSource: result.etagSource };
  }

  private toResponse(result: LyricsRetrievalResult,
    quota?: Awaited<ReturnType<MelomingLyricsQuotaService['consumeForLyrics']>>) {
    const dto: { status: string; song: LyricsRetrievalResult['song'];
      globalSong?: LyricsRetrievalResult['globalSong']; lyrics?: LyricsRetrievalResult['lyrics']; quota?: typeof quota } = {
      status: result.status, song: result.song,
    };
    if (result.globalSong) dto.globalSong = result.globalSong;
    if (quota) dto.quota = quota;
    if (result.lyrics) {
      dto.lyrics = { ...result.lyrics,
        tracking: { script: null, pixel: result.lyrics.tracking.pixel } };
    }
    return dto;
  }
}
