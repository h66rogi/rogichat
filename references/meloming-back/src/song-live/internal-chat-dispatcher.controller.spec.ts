import { InternalChatDispatcherController } from './internal-chat-dispatcher.controller';
import { SongRequestQueueService } from '../song-request/song-request-queue.service';
import { ChatGateway } from './chat/chat.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SongRequestService } from '../song-request/song-request.service';
import { SessionService } from './session.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, SongRequestSource } from '@prisma/client';
import { SongMatcherService } from '../song-request/song-matcher.service';
import { SongMatcherV2Service } from '../song-request/v2/song-matcher-v2.service';
import { MetricsService } from '../metrics';
import { ConfigService } from '@nestjs/config';

describe('InternalChatDispatcherController', () => {
  let controller: InternalChatDispatcherController;
  let queueService: { addToQueue: jest.Mock };
  let chatGateway: { broadcastChatMessage: jest.Mock };
  let prisma: {
    songRequest: { findUnique: jest.Mock };
    liveSession: { findUnique: jest.Mock };
  };
  let songRequestService: { playNext: jest.Mock };
  let sessionService: { endSession: jest.Mock; updateSettings: jest.Mock };
  let eventEmitter: { emit: jest.Mock };

  let v1Matcher: {
    matchSong: jest.Mock;
    matchByKeyword: jest.Mock;
  };
  let matcherV2: { match: jest.Mock };
  let metrics: {
    songMatcherV2OutcomesTotal: { inc: jest.Mock };
    songMatcherV2LatencySeconds: { labels: jest.Mock };
    songMatcherV2LlmCallsTotal: { inc: jest.Mock };
    songMatcherV2RescuesTotal: { inc: jest.Mock };
  };
  let config: { get: jest.Mock };

  beforeEach(() => {
    queueService = { addToQueue: jest.fn() };
    chatGateway = { broadcastChatMessage: jest.fn() };
    prisma = {
      songRequest: { findUnique: jest.fn() },
      liveSession: {
        findUnique: jest.fn().mockResolvedValue({
          channelId: 42,
          settings: { requestCommand: '!신청' },
        }),
      },
    };
    songRequestService = { playNext: jest.fn() };
    sessionService = { endSession: jest.fn(), updateSettings: jest.fn() };
    eventEmitter = { emit: jest.fn() };

    v1Matcher = {
      matchSong: jest.fn().mockResolvedValue({ matched: false }),
      matchByKeyword: jest.fn().mockResolvedValue({ matched: false }),
    };
    matcherV2 = {
      match: jest
        .fn()
        .mockResolvedValue({ matched: false, tier: 'tier1', trace: [] }),
    };
    metrics = {
      songMatcherV2OutcomesTotal: { inc: jest.fn() },
      songMatcherV2LatencySeconds: {
        labels: jest.fn().mockReturnValue({ observe: jest.fn() }),
      },
      songMatcherV2LlmCallsTotal: { inc: jest.fn() },
      songMatcherV2RescuesTotal: { inc: jest.fn() },
    };
    config = { get: jest.fn().mockReturnValue('true') }; // v2 fallback default on

    controller = new InternalChatDispatcherController(
      queueService as unknown as SongRequestQueueService,
      chatGateway as unknown as ChatGateway,
      prisma as unknown as PrismaService,
      songRequestService as unknown as SongRequestService,
      sessionService as unknown as SessionService,
      eventEmitter as unknown as EventEmitter2,
      v1Matcher as unknown as SongMatcherService,
      matcherV2 as unknown as SongMatcherV2Service,
      metrics as unknown as MetricsService,
      config as unknown as ConfigService,
    );
  });

  describe('fromChat', () => {
    const dto = {
      liveSessionId: 1,
      streamMessageId: 'chat:chzzk:abc:1712345678000-0',
      rawArtist: '아이유',
      rawTitle: '밤편지',
      rawMessage: '!신청 아이유 - 밤편지',
      requesterPlatformId: 'chzzk_user123',
      requesterNickname: '테스트유저',
      source: SongRequestSource.CHAT,
    };

    it('creates song request and returns 201', async () => {
      prisma.songRequest.findUnique.mockResolvedValue(null);
      queueService.addToQueue.mockResolvedValue({ id: 1 });

      const result = await controller.fromChat(dto);

      expect(queueService.addToQueue).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          rawArtist: '아이유',
          rawTitle: '밤편지',
          source: 'CHAT',
          streamMessageId: dto.streamMessageId,
        }),
      );
      expect(result).toEqual({ id: 1 });
    });

    it('returns existing record on duplicate streamMessageId (idempotent)', async () => {
      const existing = { id: 99 };
      prisma.songRequest.findUnique.mockResolvedValue(existing);

      const result = await controller.fromChat(dto);

      expect(queueService.addToQueue).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it('P2002 race: addToQueue throws P2002, returns existing record (race-safe idempotency)', async () => {
      // 두 Pod가 동시에 pre-check를 통과했을 때: 한 쪽만 insert 성공, 나머지는 P2002
      prisma.songRequest.findUnique
        .mockResolvedValueOnce(null) // pre-check: 없음 (아직 없음 — race 상황)
        .mockResolvedValueOnce({ id: 55 }); // post-P2002 조회: 다른 Pod가 이미 저장
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '0.0.0',
        meta: { target: ['stream_message_id'] },
      });
      queueService.addToQueue.mockRejectedValue(p2002);

      const result = await controller.fromChat(dto);

      expect(result).toEqual({ id: 55 });
    });

    describe('hybrid matching (v1 first, v2 fallback)', () => {
      it('v1이 매칭하면 v2를 호출하지 않고 songId를 addToQueue에 전달', async () => {
        prisma.songRequest.findUnique.mockResolvedValue(null);
        v1Matcher.matchSong.mockResolvedValue({
          matched: true,
          song: { id: 777 },
        });
        queueService.addToQueue.mockResolvedValue({ id: 1 });

        await controller.fromChat(dto);

        expect(matcherV2.match).not.toHaveBeenCalled();
        expect(queueService.addToQueue).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ songId: 777 }),
        );
        expect(metrics.songMatcherV2OutcomesTotal.inc).toHaveBeenCalledWith({
          outcome: 'v1_match',
          tier: 'unknown',
        });
      });

      it('v1 실패 시 v2가 매칭하면 songId 전달 + rescue 카운터 증가', async () => {
        prisma.songRequest.findUnique.mockResolvedValue(null);
        // v1: 둘 다 매칭 실패
        v1Matcher.matchSong.mockResolvedValue({ matched: false });
        v1Matcher.matchByKeyword.mockResolvedValue({ matched: false });
        // v2: 매칭
        matcherV2.match.mockResolvedValue({
          matched: true,
          autoAcceptable: true,
          song: { id: 999 },
          tier: 'tier1',
          confidence: 0.92,
          trace: [],
        });
        queueService.addToQueue.mockResolvedValue({ id: 2 });

        await controller.fromChat(dto);

        expect(matcherV2.match).toHaveBeenCalledWith(
          expect.objectContaining({ channelId: 42, rawMessage: dto.rawMessage }),
        );
        expect(queueService.addToQueue).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ songId: 999 }),
        );
        expect(metrics.songMatcherV2RescuesTotal.inc).toHaveBeenCalledWith({
          tier: 'tier1',
        });
      });

      it('v2도 실패하면 songId 없이 addToQueue 호출 (v1 매칭/requireSongMatch 정책 적용)', async () => {
        prisma.songRequest.findUnique.mockResolvedValue(null);
        v1Matcher.matchSong.mockResolvedValue({ matched: false });
        v1Matcher.matchByKeyword.mockResolvedValue({ matched: false });
        matcherV2.match.mockResolvedValue({
          matched: false,
          tier: 'tier1',
          confidence: 0,
          trace: [],
        });
        queueService.addToQueue.mockResolvedValue({ id: 3 });

        await controller.fromChat(dto);

        expect(queueService.addToQueue).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ songId: undefined }),
        );
      });

      it('SONG_MATCHER_V2_FALLBACK=false면 v2 호출 자체 안 함 (kill switch)', async () => {
        prisma.songRequest.findUnique.mockResolvedValue(null);
        v1Matcher.matchSong.mockResolvedValue({ matched: false });
        v1Matcher.matchByKeyword.mockResolvedValue({ matched: false });
        config.get.mockReturnValue('false');
        queueService.addToQueue.mockResolvedValue({ id: 4 });

        await controller.fromChat(dto);

        expect(matcherV2.match).not.toHaveBeenCalled();
        expect(metrics.songMatcherV2OutcomesTotal.inc).toHaveBeenCalledWith({
          outcome: 'v1_no_match_v2_disabled',
          tier: 'unknown',
        });
      });

      it('v2 호출 에러 시 error 카운터만 올리고 songId 없이 진행 (production 신청 영향 없음)', async () => {
        prisma.songRequest.findUnique.mockResolvedValue(null);
        v1Matcher.matchSong.mockResolvedValue({ matched: false });
        v1Matcher.matchByKeyword.mockResolvedValue({ matched: false });
        matcherV2.match.mockRejectedValue(new Error('LLM timeout'));
        queueService.addToQueue.mockResolvedValue({ id: 5 });

        await controller.fromChat(dto);

        expect(metrics.songMatcherV2OutcomesTotal.inc).toHaveBeenCalledWith({
          outcome: 'error',
          tier: 'unknown',
        });
        expect(queueService.addToQueue).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ songId: undefined }),
        );
      });
    });
  });
});
