import { BadRequestException } from '@nestjs/common';
import {
  ChannelUserBlockFeature,
  SongRequestUserBlockScope,
  SongRequestUserBlockTargetType,
  StreamPlatform,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashDi } from '../common/utils/di-hash.util';
import { SongRequestUserBlockService } from './song-request-user-block.service';

describe('SongRequestUserBlockService', () => {
  let service: SongRequestUserBlockService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      songRequestUserBlock: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(({ create }: any) => Promise.resolve(create)),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      songRequest: {
        findUnique: jest.fn(),
      },
      userIdentity: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      userPlatformVerification: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new SongRequestUserBlockService(
      prisma as unknown as PrismaService,
    );
  });

  describe('assertRequesterAllowed', () => {
    it('checks channel and global scopes with platform requester key', async () => {
      await service.assertRequesterAllowed({
        channelId: 10,
        platform: StreamPlatform.CHZZK,
        requesterPlatformId: 'viewer-1(2)',
        requestUserId: null,
      });

      expect(prisma.songRequestUserBlock.findFirst).toHaveBeenCalledWith({
        where: {
          scopeKey: { in: ['global', 'channel:10'] },
          feature: {
            in: [
              ChannelUserBlockFeature.ALL,
              ChannelUserBlockFeature.SONG_REQUEST,
            ],
          },
          OR: [
            {
              targetType: SongRequestUserBlockTargetType.PLATFORM,
              targetKey: 'platform:CHZZK:viewer-1',
            },
          ],
        },
        select: {
          id: true,
          scope: true,
          requesterNickname: true,
          reason: true,
        },
      });
    });

    it('rejects when any candidate is blocked', async () => {
      prisma.songRequestUserBlock.findFirst.mockResolvedValueOnce({
        id: 1,
        scope: SongRequestUserBlockScope.CHANNEL,
      });

      await expect(
        service.assertRequesterAllowed({
          channelId: 10,
          platform: StreamPlatform.CHZZK,
          requesterPlatformId: 'viewer-1',
          requestUserId: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('uses user, DI, and verified platform candidates for meloming user requests', async () => {
      prisma.userIdentity.findMany.mockResolvedValueOnce([{ di: 'di-value' }]);
      prisma.userPlatformVerification.findMany.mockResolvedValueOnce([
        {
          platform: StreamPlatform.CHZZK,
          platformUserId: 'verified-platform-id',
        },
      ]);

      await service.assertRequesterAllowed({
        channelId: 10,
        platform: StreamPlatform.CHZZK,
        requesterPlatformId: 'web_42',
        requestUserId: 42,
      });

      const call = prisma.songRequestUserBlock.findFirst.mock.calls[0][0];
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          {
            targetType: SongRequestUserBlockTargetType.USER,
            targetKey: 'user:42',
          },
          {
            targetType: SongRequestUserBlockTargetType.DI,
            targetKey: `di:${hashDi('di-value')}`,
          },
          {
            targetType: SongRequestUserBlockTargetType.PLATFORM,
            targetKey: 'platform:CHZZK:verified-platform-id',
          },
        ]),
      );
      expect(call.where.OR).not.toContainEqual({
        targetType: SongRequestUserBlockTargetType.PLATFORM,
        targetKey: 'platform:CHZZK:web_42',
      });
    });
  });

  describe('createBlocksFromRequest', () => {
    it('creates channel block keys for user, DI, and verified platforms from web request', async () => {
      prisma.songRequest.findUnique.mockResolvedValueOnce({
        requesterPlatformId: 'web_42',
        requesterNickname: '신청자',
        requestUserId: 42,
        isAnonymous: false,
        liveSession: {
          channelId: 10,
          platform: StreamPlatform.CHZZK,
        },
      });
      prisma.userIdentity.findMany.mockResolvedValueOnce([{ di: 'di-value' }]);
      prisma.userPlatformVerification.findMany.mockResolvedValueOnce([
        {
          platform: StreamPlatform.CHZZK,
          platformUserId: 'viewer-1(3)',
        },
        {
          platform: StreamPlatform.SOOP,
          platformUserId: 'soop-viewer',
        },
      ]);

      const result = await service.createBlocksFromRequest(100, {
        scope: SongRequestUserBlockScope.CHANNEL,
        reason: '  스팸 신청  ',
        createdByUserId: 7,
      });

      expect(result.blocks).toHaveLength(4);
      expect(prisma.songRequestUserBlock.upsert).toHaveBeenCalledTimes(4);
      const createPayloads = prisma.songRequestUserBlock.upsert.mock.calls.map(
        ([arg]: any[]) => arg.create,
      );
      expect(createPayloads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            scope: SongRequestUserBlockScope.CHANNEL,
            scopeKey: 'channel:10',
            feature: ChannelUserBlockFeature.SONG_REQUEST,
            targetType: SongRequestUserBlockTargetType.USER,
            targetKey: 'user:42',
            channelId: 10,
            requestUserId: 42,
            requesterNickname: '신청자',
            reason: '스팸 신청',
            createdByUserId: 7,
          }),
          expect.objectContaining({
            targetType: SongRequestUserBlockTargetType.DI,
            targetKey: `di:${hashDi('di-value')}`,
            diHash: hashDi('di-value'),
          }),
          expect.objectContaining({
            targetType: SongRequestUserBlockTargetType.PLATFORM,
            targetKey: 'platform:CHZZK:viewer-1',
            platform: StreamPlatform.CHZZK,
            platformUserId: 'viewer-1',
          }),
          expect.objectContaining({
            targetType: SongRequestUserBlockTargetType.PLATFORM,
            targetKey: 'platform:SOOP:soop-viewer',
            platform: StreamPlatform.SOOP,
            platformUserId: 'soop-viewer',
          }),
        ]),
      );
      expect(createPayloads).not.toContainEqual(
        expect.objectContaining({
          targetKey: 'platform:CHZZK:web_42',
        }),
      );
    });

    it('creates global blocks without channelId', async () => {
      prisma.songRequest.findUnique.mockResolvedValueOnce({
        requesterPlatformId: 'viewer-1',
        requesterNickname: '신청자',
        requestUserId: null,
        isAnonymous: false,
        liveSession: {
          channelId: 10,
          platform: StreamPlatform.CHZZK,
        },
      });

      await service.createBlocksFromRequest(100, {
        scope: SongRequestUserBlockScope.GLOBAL,
      });

      expect(prisma.songRequestUserBlock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            scopeKey_feature_targetType_targetKey: {
              scopeKey: 'global',
              feature: ChannelUserBlockFeature.SONG_REQUEST,
              targetType: SongRequestUserBlockTargetType.PLATFORM,
              targetKey: 'platform:CHZZK:viewer-1',
            },
          },
          create: expect.objectContaining({
            scope: SongRequestUserBlockScope.GLOBAL,
            scopeKey: 'global',
            feature: ChannelUserBlockFeature.SONG_REQUEST,
            channelId: null,
          }),
        }),
      );
    });
  });
});
