import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type LyricsRetrievalResult,
  LyricsRetrievalService,
} from './upstream/global-song/musixmatch/lyrics-retrieval.service.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { MelomingLyricsQuotaService } from './meloming-lyrics-quota.service.js';
import { hasExposableLyrics } from './upstream/lyrics-content.util.js';

type OverlayLyricsPayload = {
  status: LyricsRetrievalResult['status'] | 'QUOTA_EXCEEDED';
  song: LyricsRetrievalResult['song'];
  globalSong?: LyricsRetrievalResult['globalSong'];
  lyrics?: LyricsRetrievalResult['lyrics'];
  quota?: Awaited<ReturnType<MelomingLyricsQuotaService['consumeForLyrics']>>;
};

/**
 * Overlay lyrics read service (Phase C Step 2).
 *
 * Overlay app 이 OBS 안에서 가사 widget 을 띄우기 위한 read endpoint.
 * - 인증: overlay token (query) → owner channel resolve
 * - 격리: songId 가 owner channel 의 Song 이어야 함. 다른 채널 song 호출 시 404
 *   (LyricsRetrievalService.getForSongId 의 findFirst({where:{id, channelId}}) 격리
 *   재사용 — 추가 작업 없음)
 * - 응답: ConsoleLyricsResponseDto 와 동일 모양 (status 7+1종, body, synced 등)
 *
 * spec: docs/superpowers/specs/2026-04-30-lyrics-playback-state-sync-design.md §5
 */
@Injectable()
export class MelomingOverlayLyricsService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
    @Inject(MelomingLyricsQuotaService) private readonly quota: MelomingLyricsQuotaService,
  ) {}

  async getLyrics(params: {
    overlayToken: string;
    songId: number;
    liveSessionId?: number;
    songRequestId?: number;
    includeRichsync: boolean;
  }): Promise<OverlayLyricsPayload> {
    const { roomId, result } = await this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const room = await tx.prisma.rooms.findUnique({ where: { overlay_token: params.overlayToken },
        select: { id: true } });
      if (!room || room.id !== roomId) throw new NotFoundException('Overlay token not found');
      const result = await new LyricsRetrievalService(tx.prisma).getForSongId(
        params.songId, roomId, { includeRichsync: params.includeRichsync });
      return { roomId, result };
    });
    const quota = hasExposableLyrics(result)
      ? await this.quota.consumeForLyrics({
            roomId,
            ...(params.liveSessionId !== undefined ? { liveSessionId: params.liveSessionId } : {}),
            ...(params.songRequestId !== undefined ? { songRequestId: params.songRequestId } : {}),
            songId: params.songId,
          })
      : null;

    if (quota && !quota.allowed) {
      return {
        status: 'QUOTA_EXCEEDED',
        song: result.song,
        globalSong: result.globalSong,
        quota,
      };
    }

    return this.toResponse(result, quota ?? undefined);
  }

  private toResponse(
    result: LyricsRetrievalResult,
    quota?: Awaited<ReturnType<MelomingLyricsQuotaService['consumeForLyrics']>>,
  ): OverlayLyricsPayload {
    const dto: OverlayLyricsPayload = {
      status: result.status,
      song: result.song,
    };
    if (result.globalSong) dto.globalSong = result.globalSong;
    if (quota) dto.quota = quota;
    if (result.lyrics) {
      // 외부 <script src=...> 실행은 OBS 안에서 임의 코드 실행 위험.
      // 콘솔 surface 와 동일하게 script null 강제. pixel 만 허용.
      dto.lyrics = {
        ...result.lyrics,
        tracking: {
          script: null,
          pixel: result.lyrics.tracking.pixel,
        },
      };
    }
    return dto;
  }
}
