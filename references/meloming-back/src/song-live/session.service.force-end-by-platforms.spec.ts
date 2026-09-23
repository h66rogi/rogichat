import {
  ChannelVerificationStatus,
  LiveSessionStatus,
  LiveSessionType,
  StreamPlatform,
} from '@prisma/client';
import { SessionService } from './session.service';

describe('SessionService.forceEndByPlatforms', () => {
  let service: SessionService;
  let channelVerificationFindFirst: jest.Mock;
  let liveSessionFindFirst: jest.Mock;
  let liveSessionUpdate: jest.Mock;

  beforeEach(() => {
    channelVerificationFindFirst = jest
      .fn()
      .mockResolvedValue({ channelId: 7 });
    liveSessionFindFirst = jest.fn().mockResolvedValue(null);
    liveSessionUpdate = jest.fn().mockResolvedValue({
      id: 100,
      playbackRevision: 1,
    });

    const prisma = {
      channelVerification: { findFirst: channelVerificationFindFirst },
      liveSession: { findFirst: liveSessionFindFirst },
      channel: {
        findUnique: jest.fn().mockResolvedValue({ overlayToken: 'token' }),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          liveSession: { update: liveSessionUpdate },
        }),
      ),
    };

    service = new SessionService(
      prisma as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {
        liveSessionsEndedTotal: { inc: jest.fn() },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (service as any).notifyDispatcher = jest.fn().mockResolvedValue(undefined);
  });

  it('targets only auto-created sessions and leaves manual sessions active', async () => {
    await service.forceEndByPlatforms([
      {
        platform: StreamPlatform.CHZZK,
        platformChannelId: 'channel-1',
      },
    ]);

    expect(channelVerificationFindFirst).toHaveBeenCalledWith({
      where: {
        platform: StreamPlatform.CHZZK,
        platformChannelId: 'channel-1',
        status: ChannelVerificationStatus.APPROVED,
      },
      select: { channelId: true },
    });
    expect(liveSessionFindFirst).toHaveBeenCalledWith({
      where: {
        channelId: 7,
        status: LiveSessionStatus.ACTIVE,
        sessionType: LiveSessionType.STANDARD,
        sourcePerformanceId: { not: null },
      },
      select: { id: true, channelId: true },
    });
    expect(liveSessionUpdate).not.toHaveBeenCalled();
  });

  it('ends an auto-created session when the broadcast ends', async () => {
    liveSessionFindFirst.mockResolvedValue({ id: 100, channelId: 7 });

    await service.forceEndByPlatforms([
      {
        platform: StreamPlatform.CHZZK,
        platformChannelId: 'channel-1',
      },
    ]);

    expect(liveSessionUpdate).toHaveBeenCalledWith({
      where: { id: 100 },
      data: {
        status: LiveSessionStatus.ENDED,
        endedAt: expect.any(Date),
      },
    });
  });
});
