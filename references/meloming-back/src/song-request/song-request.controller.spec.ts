import { SongRequestController } from './song-request.controller';
import { SongRequestService } from './song-request.service';

describe('SongRequestController.createRequest — operator bypass routing', () => {
  let controller: SongRequestController;
  let service: jest.Mocked<
    Pick<
      SongRequestService,
      'createRequest' | 'canBypassSongRequestLimits'
    >
  >;
  let userBlockService: any;

  beforeEach(() => {
    service = {
      createRequest: jest.fn().mockResolvedValue({ id: 1 }),
      canBypassSongRequestLimits: jest.fn(),
    };
    userBlockService = {};
    controller = new SongRequestController(
      service as unknown as SongRequestService,
      userBlockService,
    );
  });

  const dto: any = {
    liveSessionId: 1,
    songId: 42,
    rawArtist: 'a',
    rawTitle: 't',
    requesterPlatformId: 'p',
    requesterNickname: 'n',
  };

  it('비로그인 호출 → allowManualBypass=false (operator 조회 호출 안 함)', async () => {
    await controller.createRequest({ user: undefined } as any, dto);
    expect(service.canBypassSongRequestLimits).not.toHaveBeenCalled();
    expect(service.createRequest).toHaveBeenCalledWith(
      dto,
      undefined,
      false,
      false,
      undefined,
    );
  });

  it('로그인 + 운영자(operator) → allowManualBypass=true', async () => {
    service.canBypassSongRequestLimits.mockResolvedValue(true);
    await controller.createRequest(
      { user: { id: 100, isAdmin: false } } as any,
      dto,
    );
    expect(service.canBypassSongRequestLimits).toHaveBeenCalledWith(
      1,
      100,
      false,
    );
    expect(service.createRequest).toHaveBeenCalledWith(
      dto,
      100,
      false,
      true,
      undefined,
    );
  });

  it('로그인 + 사이트 admin → bypass 판별에 admin 플래그 전달', async () => {
    service.canBypassSongRequestLimits.mockResolvedValue(true);
    await controller.createRequest(
      { user: { id: 200, isAdmin: true } } as any,
      dto,
    );
    expect(service.canBypassSongRequestLimits).toHaveBeenCalledWith(
      1,
      200,
      true,
    );
    expect(service.createRequest).toHaveBeenCalledWith(
      dto,
      200,
      false,
      true,
      undefined,
    );
  });

  it('로그인 + 일반 유저 → bypass=false', async () => {
    service.canBypassSongRequestLimits.mockResolvedValue(false);
    await controller.createRequest(
      { user: { id: 300, isAdmin: false } } as any,
      dto,
    );
    expect(service.createRequest).toHaveBeenCalledWith(
      dto,
      300,
      false,
      false,
      undefined,
    );
  });

  it('liveSession 미존재/권한 없음 → bypass=false', async () => {
    service.canBypassSongRequestLimits.mockResolvedValue(false);
    await controller.createRequest(
      { user: { id: 400, isAdmin: false } } as any,
      dto,
    );
    expect(service.canBypassSongRequestLimits).toHaveBeenCalledWith(
      1,
      400,
      false,
    );
    expect(service.createRequest).toHaveBeenCalledWith(
      dto,
      400,
      false,
      false,
      undefined,
    );
  });
});

describe('SongRequestController.getOperatorStatus', () => {
  let controller: SongRequestController;
  let service: jest.Mocked<Pick<SongRequestService, 'isChannelOperator'>>;
  let userBlockService: any;

  beforeEach(() => {
    service = { isChannelOperator: jest.fn() };
    userBlockService = {};
    controller = new SongRequestController(
      service as unknown as SongRequestService,
      userBlockService,
    );
  });

  it('비로그인 → { isOperator: false } 반환, service 호출 안 함', async () => {
    const result = await controller.getOperatorStatus(
      { user: undefined } as any,
      10,
    );
    expect(result).toEqual({ isOperator: false });
    expect(service.isChannelOperator).not.toHaveBeenCalled();
  });

  it('로그인 + operator → true 반환', async () => {
    service.isChannelOperator.mockResolvedValue(true);
    const result = await controller.getOperatorStatus(
      { user: { id: 100, isAdmin: false } } as any,
      10,
    );
    expect(result).toEqual({ isOperator: true });
    expect(service.isChannelOperator).toHaveBeenCalledWith(10, 100, false);
  });

  it('로그인 + 일반 유저 → false 반환', async () => {
    service.isChannelOperator.mockResolvedValue(false);
    const result = await controller.getOperatorStatus(
      { user: { id: 100, isAdmin: false } } as any,
      10,
    );
    expect(result).toEqual({ isOperator: false });
  });
});

describe('SongRequestController.getSongRequestHistory', () => {
  let controller: SongRequestController;
  let service: jest.Mocked<Pick<SongRequestService, 'getSongRequestHistory'>>;

  beforeEach(() => {
    service = {
      getSongRequestHistory: jest.fn().mockResolvedValue({
        requests: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      }),
    };
    controller = new SongRequestController(
      service as unknown as SongRequestService,
      {} as any,
    );
  });

  it('쿼리 DTO 의 songId/channelId/page/limit 를 서비스에 그대로 위임', async () => {
    await controller.getSongRequestHistory({
      songId: 10,
      channelId: 20,
      page: 2,
      limit: 50,
    } as any);

    expect(service.getSongRequestHistory).toHaveBeenCalledWith({
      songId: 10,
      channelId: 20,
      page: 2,
      limit: 50,
    });
  });

  it('page/limit 미지정 시 undefined 로 위임 (서비스가 default 처리)', async () => {
    await controller.getSongRequestHistory({
      songId: 10,
      channelId: 20,
    } as any);

    expect(service.getSongRequestHistory).toHaveBeenCalledWith({
      songId: 10,
      channelId: 20,
      page: undefined,
      limit: undefined,
    });
  });

  it('서비스 응답을 그대로 반환', async () => {
    const expected = {
      requests: [
        {
          id: 1,
          requesterNickname: '치무',
          isAnonymous: false,
          status: 'COMPLETED' as const,
          source: 'CHAT' as const,
          donationAmount: null,
          donationCurrency: null,
          createdAt: '2026-05-10T00:00:00.000Z',
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    service.getSongRequestHistory.mockResolvedValue(expected);

    const result = await controller.getSongRequestHistory({
      songId: 10,
      channelId: 20,
    } as any);

    expect(result).toBe(expected);
  });
});
