import { Logger } from '@nestjs/common';
import { DonationCurrencyBackfillService } from './donation-currency-backfill.service';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';

describe('DonationCurrencyBackfillService', () => {
  let service: DonationCurrencyBackfillService;
  let mockPrisma: { songRequest: { updateMany: jest.Mock } };
  let mockLock: { acquireLock: jest.Mock; releaseLock: jest.Mock };
  let loggerInfoSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPrisma = {
      songRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    mockLock = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(true),
    };

    service = new DonationCurrencyBackfillService(
      mockPrisma as unknown as PrismaService,
      mockLock as unknown as DistributedLockService,
    );

    // Logger 인스턴스 메서드를 spy — prototype 기준으로 교체
    loggerInfoSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    loggerWarnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('updateMany가 count:5를 반환하면 log.info에 5가 포함된 메시지를 출력한다', async () => {
    mockPrisma.songRequest.updateMany.mockResolvedValue({ count: 5 });

    await service.runBackfill();

    expect(loggerInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('5'),
    );
  });

  it('updateMany가 count:0을 반환하면 info 로그를 출력하지 않는다', async () => {
    mockPrisma.songRequest.updateMany.mockResolvedValue({ count: 0 });

    await service.runBackfill();

    // count === 0 분기는 log.info를 호출하지 않아야 함
    // acquireLock/releaseLock 로그(debug 레벨)는 별도 spy가 없으므로 무시
    const infoCallsWithCount = loggerInfoSpy.mock.calls.filter(([msg]: [string]) =>
      typeof msg === 'string' && msg.includes('0개 행'),
    );
    expect(infoCallsWithCount).toHaveLength(0);
  });

  it('락을 획득하지 못하면 updateMany를 호출하지 않는다', async () => {
    mockLock.acquireLock.mockResolvedValue(false);

    await service.runBackfill();

    expect(mockPrisma.songRequest.updateMany).not.toHaveBeenCalled();
  });

  it('prisma가 예외를 던지면 서비스가 throw하지 않고 warn 로그를 남긴다', async () => {
    mockPrisma.songRequest.updateMany.mockRejectedValue(new Error('DB 연결 오류'));

    await expect(service.runBackfill()).resolves.not.toThrow();
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('에러'),
      expect.any(Error),
    );
  });
});
