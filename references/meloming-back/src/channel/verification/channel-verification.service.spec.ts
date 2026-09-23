import { Prisma } from '@prisma/client';
import { ChannelVerificationService } from './channel-verification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../../platform/platform.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SlackWebhookService } from '../../common/slack/slack-webhook.service';
import { MetricsService } from '../../metrics';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

describe('ChannelVerificationService', () => {
  let service: ChannelVerificationService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let platformService: jest.Mocked<Partial<PlatformService>>;
  let notificationsService: jest.Mocked<Partial<NotificationsService>>;
  let slackWebhookService: jest.Mocked<Partial<SlackWebhookService>>;
  let metricsService: Partial<MetricsService>;

  beforeEach(() => {
    prisma = {
      channel: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      channelVerification: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      userPlatformVerification: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      channelVerificationLog: {
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((fn) => fn(prisma)),
    } as any;

    platformService = {
      resolvePlatform: jest.fn(),
      resolveChannelId: jest.fn(),
      resolveChannelIdAsync: jest.fn(),
    } as any;

    notificationsService = {
      sendToUser: jest.fn(),
    } as any;

    slackWebhookService = {
      sendChannelVerificationPendingAlert: jest.fn(),
    } as any;

    metricsService = {
      channelVerificationSubmissionsTotal: { inc: jest.fn() } as any,
      channelVerificationReviewsTotal: { inc: jest.fn() } as any,
    };

    service = new ChannelVerificationService(
      prisma as unknown as PrismaService,
      platformService as unknown as PlatformService,
      notificationsService as unknown as NotificationsService,
      slackWebhookService as unknown as SlackWebhookService,
      metricsService as MetricsService,
    );
  });

  describe('previewVerification', () => {
    it('일반 URL에서 채널 ID를 올바르게 추출', async () => {
      const channelId = 1;
      const userId = 100;

      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        id: channelId,
        userId,
        platformUrl: 'https://chzzk.naver.com/ddd2e6d20a6099979254f0be383c1941',
      });

      (prisma.userPlatformVerification!.findMany as jest.Mock).mockResolvedValue([
        {
          id: 1,
          platform: 'CHZZK',
          platformUserId: 'user123',
          platformChannelId: 'ddd2e6d20a6099979254f0be383c1941',
          isVerified: true,
          verifiedAt: new Date(),
        },
      ]);

      (prisma.channelVerification!.findMany as jest.Mock).mockResolvedValue([]);

      platformService.resolvePlatform!.mockReturnValue('CHZZK');
      platformService.resolveChannelIdAsync!.mockResolvedValue(
        'ddd2e6d20a6099979254f0be383c1941',
      );

      const result = await service.previewVerification(channelId, userId);

      expect(platformService.resolveChannelIdAsync).toHaveBeenCalledWith(
        'https://chzzk.naver.com/ddd2e6d20a6099979254f0be383c1941',
      );
      expect(result.detectedChannelId).toBe('ddd2e6d20a6099979254f0be383c1941');
      expect(result.canAutoVerify).toBe(true);
    });

    it('단축 URL(chzzk.id)에서 리다이렉트 따라가서 실제 채널 ID 추출', async () => {
      const channelId = 1;
      const userId = 100;

      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        id: channelId,
        userId,
        platformUrl: 'https://chzzk.id/hwina_2424',
      });

      (prisma.userPlatformVerification!.findMany as jest.Mock).mockResolvedValue([
        {
          id: 1,
          platform: 'CHZZK',
          platformUserId: 'user123',
          platformChannelId: 'ddd2e6d20a6099979254f0be383c1941',
          isVerified: true,
          verifiedAt: new Date(),
        },
      ]);

      (prisma.channelVerification!.findMany as jest.Mock).mockResolvedValue([]);

      platformService.resolvePlatform!.mockReturnValue('CHZZK');
      // resolveChannelIdAsync가 리다이렉트를 따라가서 실제 채널 ID 반환
      platformService.resolveChannelIdAsync!.mockResolvedValue(
        'ddd2e6d20a6099979254f0be383c1941',
      );

      const result = await service.previewVerification(channelId, userId);

      expect(platformService.resolveChannelIdAsync).toHaveBeenCalledWith(
        'https://chzzk.id/hwina_2424',
      );
      // 단축 URL이지만 리다이렉트 따라가서 실제 채널 ID가 추출됨
      expect(result.detectedChannelId).toBe('ddd2e6d20a6099979254f0be383c1941');
      expect(result.canAutoVerify).toBe(true);
      expect(result.autoVerifyFailReason).toBeNull();
    });

    it('단축 URL에서 shortCode만 추출되면 자동 인증 실패 (버그 재현)', async () => {
      const channelId = 1;
      const userId = 100;

      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        id: channelId,
        userId,
        platformUrl: 'https://chzzk.id/hwina_2424',
      });

      (prisma.userPlatformVerification!.findMany as jest.Mock).mockResolvedValue([
        {
          id: 1,
          platform: 'CHZZK',
          platformUserId: 'user123',
          platformChannelId: 'ddd2e6d20a6099979254f0be383c1941',
          isVerified: true,
          verifiedAt: new Date(),
        },
      ]);

      (prisma.channelVerification!.findMany as jest.Mock).mockResolvedValue([]);

      platformService.resolvePlatform!.mockReturnValue('CHZZK');
      // 버그 상황: 동기 메서드처럼 shortCode만 반환되는 경우
      platformService.resolveChannelIdAsync!.mockResolvedValue('hwina_2424');

      const result = await service.previewVerification(channelId, userId);

      expect(result.detectedChannelId).toBe('hwina_2424');
      expect(result.canAutoVerify).toBe(false);
      expect(result.autoVerifyFailReason).toBe(
        '채널 ID(hwina_2424)가 인증된 ID(ddd2e6d20a6099979254f0be383c1941)와 일치하지 않습니다.',
      );
    });

    it('CIME URL은 CIME 플랫폼으로 감지되고 자동 인증 불가 사유를 반환한다', async () => {
      const channelId = 10;
      const userId = 200;

      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        id: channelId,
        userId,
        platformUrl: 'https://ci.me/@indongyoo',
      });
      (prisma.userPlatformVerification!.findMany as jest.Mock).mockResolvedValue(
        [],
      );
      (prisma.channelVerification!.findMany as jest.Mock).mockResolvedValue([]);

      platformService.resolvePlatform!.mockReturnValue('CIME' as any);
      platformService.resolveChannelIdAsync!.mockResolvedValue('indongyoo');

      const result = await service.previewVerification(channelId, userId);

      expect(result.detectedPlatform).toBe('CIME');
      expect(result.canAutoVerify).toBe(false);
      // CIME OAuth 전환 이후: CIME 인증 미완료 시 해당 사유 반환
      expect(result.autoVerifyFailReason).toBe(
        'CIME 플랫폼 인증이 완료되지 않았습니다.',
      );
    });

    it('채널이 없으면 NotFoundException 발생', async () => {
      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.previewVerification(999, 100)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('소유자가 아니면 ForbiddenException 발생', async () => {
      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        userId: 999,
        platformUrl: 'https://chzzk.naver.com/abc123',
      });

      await expect(service.previewVerification(1, 100)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('createVerification', () => {
    it('단축 URL에서 resolveChannelIdAsync를 사용하여 채널 ID 추출', async () => {
      const channelId = 1;
      const userId = 100;

      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        id: channelId,
        userId,
        platformUrl: 'https://chzzk.id/hwina_2424',
        name: '테스트 채널',
      });

      (prisma.channelVerification!.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.channelVerification!.findUnique as jest.Mock).mockResolvedValue(null);

      (prisma.userPlatformVerification!.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        userId,
        platform: 'CHZZK',
        platformUserId: 'user123',
        platformChannelId: 'ddd2e6d20a6099979254f0be383c1941',
        isVerified: true,
      });

      (prisma.channelVerification!.create as jest.Mock).mockResolvedValue({
        id: 1,
        channelId,
        userId,
        platform: 'CHZZK',
        platformChannelId: 'ddd2e6d20a6099979254f0be383c1941',
        status: 'APPROVED',
      });

      (prisma.channelVerificationLog!.create as jest.Mock).mockResolvedValue({});
      (prisma.channel!.update as jest.Mock).mockResolvedValue({});

      platformService.resolvePlatform!.mockReturnValue('CHZZK');
      // 리다이렉트 따라가서 실제 채널 ID 반환
      platformService.resolveChannelIdAsync!.mockResolvedValue(
        'ddd2e6d20a6099979254f0be383c1941',
      );

      const result = await service.createVerification(channelId, userId, {});

      expect(platformService.resolveChannelIdAsync).toHaveBeenCalledWith(
        'https://chzzk.id/hwina_2424',
      );
      expect(result.status).toBe('APPROVED');
    });

    it('일반 chzzk.naver.com URL에서도 resolveChannelIdAsync 사용', async () => {
      const channelId = 1;
      const userId = 100;

      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        id: channelId,
        userId,
        platformUrl: 'https://chzzk.naver.com/ddd2e6d20a6099979254f0be383c1941',
        name: '테스트 채널',
      });

      (prisma.channelVerification!.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.channelVerification!.findUnique as jest.Mock).mockResolvedValue(null);

      (prisma.userPlatformVerification!.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        userId,
        platform: 'CHZZK',
        platformUserId: 'user123',
        platformChannelId: 'ddd2e6d20a6099979254f0be383c1941',
        isVerified: true,
      });

      (prisma.channelVerification!.create as jest.Mock).mockResolvedValue({
        id: 1,
        channelId,
        userId,
        platform: 'CHZZK',
        platformChannelId: 'ddd2e6d20a6099979254f0be383c1941',
        status: 'APPROVED',
      });

      (prisma.channelVerificationLog!.create as jest.Mock).mockResolvedValue({});
      (prisma.channel!.update as jest.Mock).mockResolvedValue({});

      platformService.resolvePlatform!.mockReturnValue('CHZZK');
      platformService.resolveChannelIdAsync!.mockResolvedValue(
        'ddd2e6d20a6099979254f0be383c1941',
      );

      await service.createVerification(channelId, userId, {});

      expect(platformService.resolveChannelIdAsync).toHaveBeenCalledWith(
        'https://chzzk.naver.com/ddd2e6d20a6099979254f0be383c1941',
      );
    });

    it('resolvePlatform이 CIME이면 CIME 플랫폼으로 PENDING 수동 심사가 생성된다', async () => {
      const channelId = 2;
      const userId = 101;

      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        id: channelId,
        userId,
        platformUrl: 'https://ci.me/@indongyoo/live',
        name: '씨미 채널',
      });

      (prisma.channelVerification!.findFirst as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.channelVerification!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.channelVerification!.create as jest.Mock).mockResolvedValue({
        id: 22,
        channelId,
        userId,
        platform: 'CIME',
        platformChannelId: 'indongyoo',
        status: 'PENDING',
      });
      (prisma.channelVerificationLog!.create as jest.Mock).mockResolvedValue(
        {},
      );
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: userId,
        nickname: 'tester',
        email: 'tester@example.com',
        phone: null,
      });
      (
        slackWebhookService.sendChannelVerificationPendingAlert as jest.Mock
      ).mockResolvedValue({});

      platformService.resolvePlatform!.mockReturnValue('CIME' as any);
      platformService.resolveChannelIdAsync!.mockResolvedValue('indongyoo');

      const result = await service.createVerification(channelId, userId, {
        evidenceImageUrl: 'https://example.com/evidence.png',
        evidenceDescription: '씨미 소유권 인증',
      });

      expect(result.platform).toBe('CIME');
      expect(result.status).toBe('PENDING');
    });

    it('platformUrl이 없어도 dto.platform=CIME이면 CIME으로 수동 심사가 생성된다', async () => {
      const channelId = 3;
      const userId = 102;

      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        id: channelId,
        userId,
        platformUrl: null,
        name: '씨미 수동 채널',
      });

      (prisma.channelVerification!.findFirst as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.channelVerification!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.channelVerification!.create as jest.Mock).mockResolvedValue({
        id: 23,
        channelId,
        userId,
        platform: 'CIME',
        platformChannelId: null,
        status: 'PENDING',
      });
      (prisma.channelVerificationLog!.create as jest.Mock).mockResolvedValue(
        {},
      );
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: userId,
        nickname: 'tester',
        email: 'tester@example.com',
        phone: null,
      });
      (
        slackWebhookService.sendChannelVerificationPendingAlert as jest.Mock
      ).mockResolvedValue({});

      const result = await service.createVerification(channelId, userId, {
        platform: 'CIME',
        evidenceImageUrl: 'https://example.com/evidence.png',
        evidenceDescription: '씨미 소유권 인증',
      });

      expect(result.platform).toBe('CIME');
      expect(result.status).toBe('PENDING');
      // CIME OAuth 전환(dd302e3) 이후 CIME도 AUTO_VERIFY_FAILED로 분류된다
      expect(prisma.channelVerification!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            platform: 'CIME',
            pendingReason: 'AUTO_VERIFY_FAILED',
          }),
        }),
      );
    });
  });

  describe('getVerifications', () => {
    it('기존 OTHER 인증이라도 채널 URL이 ci.me면 CIME으로 표시 플랫폼을 보정한다', async () => {
      const channelId = 11;
      const userId = 500;

      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        userId,
        platformUrl: 'https://ci.me/@indongyoo',
      });

      (prisma.channelVerification!.findMany as jest.Mock).mockResolvedValue([
        {
          id: 77,
          channelId,
          userId,
          platform: 'OTHER',
          platformChannelId: null,
          status: 'APPROVED',
          pendingReason: null,
          evidenceImageUrl: null,
          evidenceDescription: null,
          rejectionReason: null,
          reviewedAt: new Date(),
          reviewedByUserId: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      platformService.resolvePlatform!.mockReturnValue('CIME' as any);

      const result = await service.getVerifications(channelId, userId);

      expect(result[0]?.platform).toBe('CIME');
      // 표시 보정은 응답 매핑에서만 수행하고 DB는 수정하지 않는다.
      expect(prisma.channelVerification!.update).not.toHaveBeenCalled();
    });
  });

  describe('createVerification — CIME OAuth 전환 이후 방어', () => {
    it('채널 URL이 ci.me인데 dto.platform=OTHER로 증빙 신청하면 BadRequestException', async () => {
      const channelId = 2586;
      const userId = 5546;

      (prisma.channel!.findUnique as jest.Mock).mockResolvedValue({
        id: channelId,
        userId,
        platformUrl: 'https://ci.me/@lumoungs2',
        name: '루뭉S2',
      });

      platformService.resolvePlatform!.mockReturnValue('CIME' as any);
      platformService.resolveChannelIdAsync!.mockResolvedValue('lumoungs2');

      await expect(
        service.createVerification(channelId, userId, {
          platform: 'OTHER' as any,
          evidenceImageUrl: 'https://example.com/evidence.png',
          evidenceDescription: '증빙',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.channelVerification!.create).not.toHaveBeenCalled();
    });
  });

  describe('reviewVerificationAdmin — 충돌 레코드 안전 처리', () => {
    const buildPending = () => ({
      id: 1274,
      channelId: 2586,
      userId: 5546,
      platform: 'OTHER',
      platformChannelId: 'lumoungs2',
      status: 'PENDING',
      pendingReason: 'OTHER_PLATFORM',
      evidenceImageUrl: null,
      evidenceDescription: null,
      rejectionReason: null,
      reviewedAt: null,
      reviewedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      channel: { name: '루뭉S2', platformUrl: 'https://ci.me/@lumoungs2' },
      user: { id: 5546 },
    });

    it('APPROVE: OTHER→CIME 전환 시 충돌하는 REVOKED 레코드가 있으면 삭제 후 승인한다', async () => {
      (prisma.channelVerification!.findUnique as jest.Mock).mockImplementation(
        ({ where }: any) => {
          if (where.id === 1274) return Promise.resolve(buildPending());
          if (where.channelId_platform) {
            return Promise.resolve({ id: 1132, status: 'REVOKED' });
          }
          return Promise.resolve(null);
        },
      );
      platformService.resolvePlatform!.mockReturnValue('CIME' as any);
      (prisma.channelVerification!.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (
        prisma.channelVerification!.findUniqueOrThrow as jest.Mock
      ).mockResolvedValue({
        ...buildPending(),
        platform: 'CIME',
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedByUserId: 337,
      });

      const result = await service.reviewVerificationAdmin(
        1274,
        337,
        'APPROVE' as any,
      );

      expect(prisma.channelVerification!.delete).toHaveBeenCalledWith({
        where: { id: 1132 },
      });
      expect(prisma.channelVerification!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1274, status: 'PENDING' },
          data: expect.objectContaining({
            platform: 'CIME',
            status: 'APPROVED',
          }),
        }),
      );
      expect((result as any).platform).toBe('CIME');
    });

    it('APPROVE: OTHER→CIME 전환 시 충돌하는 활성 레코드가 있으면 ConflictException', async () => {
      (prisma.channelVerification!.findUnique as jest.Mock).mockImplementation(
        ({ where }: any) => {
          if (where.id === 1274) return Promise.resolve(buildPending());
          if (where.channelId_platform) {
            return Promise.resolve({ id: 1132, status: 'APPROVED' });
          }
          return Promise.resolve(null);
        },
      );
      platformService.resolvePlatform!.mockReturnValue('CIME' as any);

      await expect(
        service.reviewVerificationAdmin(1274, 337, 'APPROVE' as any),
      ).rejects.toThrow(ConflictException);

      expect(prisma.channelVerification!.delete).not.toHaveBeenCalled();
      expect(prisma.channelVerification!.updateMany).not.toHaveBeenCalled();
    });

    it('REJECT: platform 재분류를 수행하지 않아 활성 CIME 레코드가 있어도 거절이 가능하다', async () => {
      (prisma.channelVerification!.findUnique as jest.Mock).mockImplementation(
        ({ where }: any) => {
          if (where.id === 1274) return Promise.resolve(buildPending());
          // channelId_platform 조회는 수행되지 않아야 한다 (REJECT 분기)
          if (where.channelId_platform) {
            return Promise.resolve({ id: 1132, status: 'APPROVED' });
          }
          return Promise.resolve(null);
        },
      );
      platformService.resolvePlatform!.mockReturnValue('CIME' as any);
      (prisma.channelVerification!.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (
        prisma.channelVerification!.findUniqueOrThrow as jest.Mock
      ).mockResolvedValue({
        ...buildPending(),
        status: 'REJECTED',
        rejectionReason: '증빙 불충분',
        reviewedAt: new Date(),
        reviewedByUserId: 337,
      });

      const result = await service.reviewVerificationAdmin(
        1274,
        337,
        'REJECT' as any,
        '증빙 불충분',
      );

      // REJECT는 platform을 원래 값(OTHER)으로 유지한다
      expect(prisma.channelVerification!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1274, status: 'PENDING' },
          data: expect.objectContaining({
            platform: 'OTHER',
            status: 'REJECTED',
            rejectionReason: '증빙 불충분',
          }),
        }),
      );
      expect(prisma.channelVerification!.delete).not.toHaveBeenCalled();
      expect((result as any).status).toBe('REJECTED');
    });

    it('updateMany count=0이면 다른 세션이 이미 심사한 것으로 간주해 ConflictException', async () => {
      (prisma.channelVerification!.findUnique as jest.Mock).mockImplementation(
        ({ where }: any) => {
          if (where.id === 1274) return Promise.resolve(buildPending());
          return Promise.resolve(null);
        },
      );
      platformService.resolvePlatform!.mockReturnValue('OTHER' as any);
      // effectivePlatform == verification.platform이라 충돌 선검사 스킵,
      // 하지만 updateMany가 count=0을 반환 → 409
      (prisma.channelVerification!.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await expect(
        service.reviewVerificationAdmin(1274, 337, 'APPROVE' as any),
      ).rejects.toThrow(ConflictException);
    });

    it('트랜잭션 중 Prisma P2002가 발생하면 ConflictException으로 변환한다', async () => {
      (prisma.channelVerification!.findUnique as jest.Mock).mockImplementation(
        ({ where }: any) => {
          if (where.id === 1274) return Promise.resolve(buildPending());
          if (where.channelId_platform) return Promise.resolve(null);
          return Promise.resolve(null);
        },
      );
      platformService.resolvePlatform!.mockReturnValue('CIME' as any);

      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: 'x' },
      );
      (prisma.channelVerification!.updateMany as jest.Mock).mockRejectedValue(
        p2002,
      );

      await expect(
        service.reviewVerificationAdmin(1274, 337, 'APPROVE' as any),
      ).rejects.toThrow(ConflictException);
    });
  });
});
