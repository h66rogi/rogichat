import {
  LiveSessionStatus,
  ChannelVerificationStatus,
  StreamPlatform,
} from '@prisma/client';
import { SessionService } from './session.service';

/**
 * SessionService.startByPlatforms — competitor 폴러가 외부 공연 시작 감지 시 호출.
 * forceEndByPlatforms 의 대칭. (platform, platformChannelId) -> ChannelVerification
 * (APPROVED) -> channelId 로 LiveSession 생성 + 'live-session.started' emit.
 */
describe('SessionService.startByPlatforms', () => {
  let service: SessionService;
  let channelVerificationFindFirst: jest.Mock;
  let liveSessionFindFirst: jest.Mock;
  let liveSessionCreate: jest.Mock;
  let liveSessionFindUnique: jest.Mock;
  let channelFindUnique: jest.Mock;
  let emit: jest.Mock;

  beforeEach(() => {
    channelVerificationFindFirst = jest.fn();
    liveSessionFindFirst = jest.fn().mockResolvedValue(null);
    liveSessionCreate = jest.fn().mockResolvedValue({ id: 100 });
    liveSessionFindUnique = jest.fn().mockResolvedValue({
      id: 100,
      channelId: 7,
      platform: 'CHZZK',
      platformChannelId: 'abc',
      startedAt: new Date('2026-05-22T16:41:40.926Z'),
      settings: {},
    });
    channelFindUnique = jest
      .fn()
      .mockResolvedValue({ overlayToken: 'tok', name: 'C' });
    emit = jest.fn();

    const transaction = jest.fn(async (cb: any) =>
      cb({
        liveSession: {
          create: liveSessionCreate,
          findUnique: liveSessionFindUnique,
          // GATE 0: startByPlatforms bumps playbackRevision inside the transaction.
          update: jest.fn().mockResolvedValue({ id: 100, playbackRevision: 1 }),
        },
        liveSessionSettings: { create: jest.fn().mockResolvedValue({}) },
      }),
    );

    const prisma = {
      channelVerification: { findFirst: channelVerificationFindFirst },
      liveSession: { findFirst: liveSessionFindFirst },
      channel: { findUnique: channelFindUnique, update: jest.fn() },
      $transaction: transaction,
    };
    const eventEmitter = { emit };
    const metricsService = {
      liveSessionsStartedTotal: { inc: jest.fn() },
    };
    const channelSongRequestSettingsService = {
      getByChannelId: jest.fn().mockResolvedValue({}),
    };

    service = new SessionService(
      prisma as any, // 1 prisma
      {} as any, // 2 chzzkChatService
      {} as any, // 3 soopChatService
      eventEmitter as any, // 4 eventEmitter
      {} as any, // 5 channelService
      {} as any, // 6 songRequestQueueService
      metricsService as any, // 7 metricsService
      {} as any, // 8 configService
      channelSongRequestSettingsService as any, // 9 channelSongRequestSettingsService
      {} as any, // 10 channelSongRequestSettingsNotifier
    );
    // 내부 메서드는 spy 로 격리 (다른 의존 회피)
    (service as any).withEffectiveSettings = jest.fn(async (s: any) => ({
      id: s.id,
      settings: {},
    }));
    (service as any).notifyDispatcher = jest.fn().mockResolvedValue(undefined);
  });

  it('skips when no APPROVED verification', async () => {
    channelVerificationFindFirst.mockResolvedValue(null);
    const r = await service.startByPlatforms([
      { platform: StreamPlatform.CHZZK, platformChannelId: 'abc', sourcePerformanceId: 1 },
    ]);
    expect(r).toEqual([]);
    expect(liveSessionCreate).not.toHaveBeenCalled();
  });

  it('skips when channel already has an ACTIVE session', async () => {
    channelVerificationFindFirst.mockResolvedValue({ channelId: 7, userId: 9 });
    liveSessionFindFirst.mockResolvedValue({ id: 50 });
    const r = await service.startByPlatforms([
      { platform: StreamPlatform.CHZZK, platformChannelId: 'abc', sourcePerformanceId: 1 },
    ]);
    expect(r).toEqual([]);
    expect(liveSessionCreate).not.toHaveBeenCalled();
  });

  it('creates session + emits live-session.started for matched new performance', async () => {
    channelVerificationFindFirst.mockResolvedValue({ channelId: 7, userId: 9 });
    liveSessionFindFirst.mockResolvedValue(null);
    const r = await service.startByPlatforms([
      { platform: StreamPlatform.CHZZK, platformChannelId: 'abc', sourcePerformanceId: 6541 },
    ]);
    expect(liveSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channelId: 7,
          userId: 9,
          platform: StreamPlatform.CHZZK,
          platformChannelId: 'abc',
          sourcePerformanceId: 6541,
          status: LiveSessionStatus.ACTIVE,
        }),
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      'live-session.started',
      expect.objectContaining({ sessionId: 100 }),
    );
    expect(r).toEqual([{ sessionId: 100, channelId: 7 }]);
  });
});
