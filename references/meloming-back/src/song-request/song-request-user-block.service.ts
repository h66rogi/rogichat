import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelUserBlockFeature,
  SongRequestUserBlockScope,
  SongRequestUserBlockTargetType,
  StreamPlatform,
} from '@prisma/client';
import { ENCRYPTED_USER_IDENTITY_SENTINEL } from '../common/encryption/user-identity-encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashDi } from '../common/utils/di-hash.util';
import { SongRequestUserBlockTargetBasis } from './dto/request/song-request-user-block.dto';

type BlockCandidate = {
  targetType: SongRequestUserBlockTargetType;
  targetKey: string;
  requestUserId?: number | null;
  platform?: StreamPlatform | null;
  platformUserId?: string | null;
  diHash?: string | null;
};

@Injectable()
export class SongRequestUserBlockService {
  constructor(private readonly prisma: PrismaService) {}

  async assertRequesterAllowed(input: {
    channelId: number;
    feature?: ChannelUserBlockFeature;
    platform: StreamPlatform | null;
    requesterPlatformId: string;
    requestUserId: number | null;
  }): Promise<void> {
    const candidates = await this.buildCandidates({
      platform: input.platform,
      requesterPlatformId: input.requesterPlatformId,
      requestUserId: input.requestUserId,
      isAnonymous: input.requesterPlatformId.startsWith('anon_'),
    });

    if (candidates.length === 0) {
      return;
    }

    const block = await this.prisma.songRequestUserBlock.findFirst({
      where: {
        scopeKey: { in: ['global', this.channelScopeKey(input.channelId)] },
        feature: {
          in: [
            ChannelUserBlockFeature.ALL,
            input.feature ?? ChannelUserBlockFeature.SONG_REQUEST,
          ],
        },
        OR: candidates.map((candidate) => ({
          targetType: candidate.targetType,
          targetKey: candidate.targetKey,
        })),
      },
      select: {
        id: true,
        scope: true,
        requesterNickname: true,
        reason: true,
      },
    });

    if (block) {
      throw new BadRequestException('차단된 신청자입니다.');
    }
  }

  async isMelomingUserBlocked(input: {
    channelId: number;
    userId: number;
    feature: ChannelUserBlockFeature;
  }): Promise<boolean> {
    const candidates = await this.buildCandidates({
      platform: null,
      requesterPlatformId: `web_${input.userId}`,
      requestUserId: input.userId,
      isAnonymous: false,
    });
    if (candidates.length === 0) return false;

    const block = await this.prisma.songRequestUserBlock.findFirst({
      where: {
        scopeKey: { in: ['global', this.channelScopeKey(input.channelId)] },
        feature: { in: [ChannelUserBlockFeature.ALL, input.feature] },
        OR: candidates.map((candidate) => ({
          targetType: candidate.targetType,
          targetKey: candidate.targetKey,
        })),
      },
      select: { id: true },
    });
    return Boolean(block);
  }

  async createBlocksFromRequest(
    requestId: number,
    input: {
      scope: SongRequestUserBlockScope;
      features?: ChannelUserBlockFeature[];
      targetBasis?: SongRequestUserBlockTargetBasis;
      reason?: string;
      createdByUserId?: number | null;
    },
  ) {
    const request = await this.prisma.songRequest.findUnique({
      where: { id: requestId },
      select: {
        requesterPlatformId: true,
        requesterNickname: true,
        requestUserId: true,
        isAnonymous: true,
        liveSession: {
          select: {
            channelId: true,
            platform: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('신청곡을 찾을 수 없습니다.');
    }

    const channelId =
      input.scope === SongRequestUserBlockScope.CHANNEL
        ? request.liveSession.channelId
        : null;
    const targetBasis =
      input.targetBasis ?? SongRequestUserBlockTargetBasis.AUTO;
    const allCandidates = await this.buildCandidates({
      platform: request.liveSession.platform,
      requesterPlatformId: request.requesterPlatformId,
      requestUserId: request.requestUserId,
      isAnonymous: request.isAnonymous,
    });
    const candidates = this.filterCandidatesByTargetBasis(
      allCandidates,
      targetBasis,
    );

    if (candidates.length === 0) {
      throw new BadRequestException('차단할 수 있는 신청자 식별자가 없습니다.');
    }

    const scopeKey =
      input.scope === SongRequestUserBlockScope.GLOBAL
        ? 'global'
        : this.channelScopeKey(request.liveSession.channelId);
    const reason = this.normalizeReason(input.reason);
    const features = this.normalizeFeatures(input.features);

    const blocks = [];
    for (const feature of features) {
      for (const candidate of candidates) {
        const block = await this.prisma.songRequestUserBlock.upsert({
          where: {
            scopeKey_feature_targetType_targetKey: {
              scopeKey,
              feature,
              targetType: candidate.targetType,
              targetKey: candidate.targetKey,
            },
          },
          create: {
            scope: input.scope,
            scopeKey,
            feature,
            targetType: candidate.targetType,
            targetKey: candidate.targetKey,
            channelId,
            requestUserId: candidate.requestUserId ?? null,
            platform: candidate.platform ?? null,
            platformUserId: candidate.platformUserId ?? null,
            diHash: candidate.diHash ?? null,
            requesterNickname: request.requesterNickname,
            reason,
            createdByUserId: input.createdByUserId ?? null,
          },
          update: {
            requesterNickname: request.requesterNickname,
            reason,
            createdByUserId: input.createdByUserId ?? null,
          },
        });
        blocks.push(block);
      }
    }

    return { blocks };
  }

  async createBlockFromTarget(input: {
    scope: SongRequestUserBlockScope;
    channelId?: number | null;
    features?: ChannelUserBlockFeature[];
    targetBasis: SongRequestUserBlockTargetBasis;
    platform?: StreamPlatform;
    platformUserId?: string;
    melomingUserId?: number;
    displayName?: string;
    reason?: string;
    createdByUserId?: number | null;
  }) {
    if (input.targetBasis === SongRequestUserBlockTargetBasis.AUTO) {
      throw new BadRequestException(
        '직접 차단 생성에는 대상 기준이 필요합니다.',
      );
    }
    const channelId =
      input.scope === SongRequestUserBlockScope.CHANNEL
        ? input.channelId
        : null;
    if (input.scope === SongRequestUserBlockScope.CHANNEL && !channelId) {
      throw new BadRequestException('채널 차단에는 channelId가 필요합니다.');
    }

    const candidates =
      input.targetBasis === SongRequestUserBlockTargetBasis.PLATFORM_USER
        ? this.buildPlatformCandidates(input.platform, input.platformUserId)
        : await this.buildMelomingUserCandidates(input.melomingUserId);
    if (candidates.length === 0) {
      throw new BadRequestException('차단할 수 있는 대상 식별자가 없습니다.');
    }

    const scopeKey =
      input.scope === SongRequestUserBlockScope.GLOBAL
        ? 'global'
        : this.channelScopeKey(channelId!);
    const features = this.normalizeFeatures(input.features);
    const reason = this.normalizeReason(input.reason);
    const requesterNickname =
      this.normalizeDisplayName(input.displayName) ??
      (input.targetBasis === SongRequestUserBlockTargetBasis.PLATFORM_USER
        ? `${input.platform}:${input.platformUserId}`
        : `멜로밍 유저 #${input.melomingUserId}`);

    const blocks = [];
    for (const feature of features) {
      for (const candidate of candidates) {
        const block = await this.prisma.songRequestUserBlock.upsert({
          where: {
            scopeKey_feature_targetType_targetKey: {
              scopeKey,
              feature,
              targetType: candidate.targetType,
              targetKey: candidate.targetKey,
            },
          },
          create: {
            scope: input.scope,
            scopeKey,
            feature,
            targetType: candidate.targetType,
            targetKey: candidate.targetKey,
            channelId,
            requestUserId: candidate.requestUserId ?? null,
            platform: candidate.platform ?? null,
            platformUserId: candidate.platformUserId ?? null,
            diHash: candidate.diHash ?? null,
            requesterNickname,
            reason,
            createdByUserId: input.createdByUserId ?? null,
          },
          update: {
            requesterNickname,
            reason,
            createdByUserId: input.createdByUserId ?? null,
          },
        });
        blocks.push(block);
      }
    }

    return { blocks };
  }

  async listBlocks(channelId: number, includeGlobal = true) {
    const scopeKeys = [this.channelScopeKey(channelId)];
    if (includeGlobal) {
      scopeKeys.push('global');
    }

    return this.prisma.songRequestUserBlock.findMany({
      where: { scopeKey: { in: scopeKeys } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findBlockById(blockId: number) {
    return this.prisma.songRequestUserBlock.findUnique({
      where: { id: blockId },
    });
  }

  async deleteBlock(blockId: number): Promise<void> {
    await this.prisma.songRequestUserBlock.delete({
      where: { id: blockId },
    });
  }

  private async buildCandidates(input: {
    platform: StreamPlatform | null;
    requesterPlatformId: string;
    requestUserId: number | null;
    isAnonymous: boolean;
  }): Promise<BlockCandidate[]> {
    const dedup = new Map<string, BlockCandidate>();
    const add = (candidate: BlockCandidate) => {
      dedup.set(`${candidate.targetType}:${candidate.targetKey}`, candidate);
    };

    if (input.isAnonymous || input.requesterPlatformId.startsWith('anon_')) {
      add({
        targetType: SongRequestUserBlockTargetType.ANONYMOUS,
        targetKey: `anonymous:${input.requesterPlatformId}`,
      });
    } else if (
      input.platform &&
      input.requesterPlatformId &&
      !input.requesterPlatformId.startsWith('web_')
    ) {
      const platformUserId = this.normalizePlatformUserId(
        input.requesterPlatformId,
      );
      add({
        targetType: SongRequestUserBlockTargetType.PLATFORM,
        targetKey: this.platformTargetKey(input.platform, platformUserId),
        platform: input.platform,
        platformUserId,
      });
    }

    if (input.requestUserId) {
      add({
        targetType: SongRequestUserBlockTargetType.USER,
        targetKey: `user:${input.requestUserId}`,
        requestUserId: input.requestUserId,
      });

      const [identities, verifications] = await Promise.all([
        this.prisma.userIdentity.findMany({
          where: {
            userId: input.requestUserId,
            OR: [
              { diHash: { not: null } },
              { di: { not: { startsWith: 'manual_di_' } } },
            ],
          },
          select: { di: true, diHash: true },
          distinct: ['diHash', 'di'],
        }),
        this.prisma.userPlatformVerification.findMany({
          where: {
            userId: input.requestUserId,
            isVerified: true,
          },
          select: {
            platform: true,
            platformUserId: true,
          },
        }),
      ]);

      for (const identity of identities) {
        const diHash =
          identity.diHash ??
          (identity.di !== ENCRYPTED_USER_IDENTITY_SENTINEL
            ? hashDi(identity.di)
            : null);
        if (!diHash) continue;
        add({
          targetType: SongRequestUserBlockTargetType.DI,
          targetKey: `di:${diHash}`,
          diHash,
          requestUserId: input.requestUserId,
        });
      }

      for (const verification of verifications) {
        const platformUserId = this.normalizePlatformUserId(
          verification.platformUserId,
        );
        add({
          targetType: SongRequestUserBlockTargetType.PLATFORM,
          targetKey: this.platformTargetKey(
            verification.platform,
            platformUserId,
          ),
          platform: verification.platform,
          platformUserId,
          requestUserId: input.requestUserId,
        });
      }
    }

    return Array.from(dedup.values());
  }

  private filterCandidatesByTargetBasis(
    candidates: BlockCandidate[],
    targetBasis: SongRequestUserBlockTargetBasis,
  ): BlockCandidate[] {
    if (targetBasis === SongRequestUserBlockTargetBasis.PLATFORM_USER) {
      return candidates.filter(
        (candidate) =>
          candidate.targetType === SongRequestUserBlockTargetType.PLATFORM,
      );
    }
    if (targetBasis === SongRequestUserBlockTargetBasis.MELOMING_USER) {
      return candidates.filter(
        (candidate) =>
          candidate.targetType === SongRequestUserBlockTargetType.USER ||
          candidate.targetType === SongRequestUserBlockTargetType.DI,
      );
    }
    return candidates;
  }

  private buildPlatformCandidates(
    platform?: StreamPlatform,
    platformUserId?: string,
  ): BlockCandidate[] {
    if (!platform || !platformUserId?.trim()) {
      throw new BadRequestException('플랫폼과 플랫폼 유저 ID가 필요합니다.');
    }
    const normalizedPlatformUserId =
      this.normalizePlatformUserId(platformUserId);
    return [
      {
        targetType: SongRequestUserBlockTargetType.PLATFORM,
        targetKey: this.platformTargetKey(platform, normalizedPlatformUserId),
        platform,
        platformUserId: normalizedPlatformUserId,
      },
    ];
  }

  private async buildMelomingUserCandidates(
    melomingUserId?: number,
  ): Promise<BlockCandidate[]> {
    if (!melomingUserId) {
      throw new BadRequestException('멜로밍 유저 ID가 필요합니다.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: melomingUserId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('유저를 찾을 수 없습니다.');
    }

    return this.filterCandidatesByTargetBasis(
      await this.buildCandidates({
        platform: null,
        requesterPlatformId: `web_${melomingUserId}`,
        requestUserId: melomingUserId,
        isAnonymous: false,
      }),
      SongRequestUserBlockTargetBasis.MELOMING_USER,
    );
  }

  private normalizeFeatures(
    features?: ChannelUserBlockFeature[],
  ): ChannelUserBlockFeature[] {
    const values = features?.length
      ? features
      : [ChannelUserBlockFeature.SONG_REQUEST];
    if (values.includes(ChannelUserBlockFeature.ALL)) {
      return [ChannelUserBlockFeature.ALL];
    }
    return Array.from(new Set(values));
  }

  private channelScopeKey(channelId: number): string {
    return `channel:${channelId}`;
  }

  private platformTargetKey(
    platform: StreamPlatform,
    platformUserId: string,
  ): string {
    return `platform:${platform}:${platformUserId}`;
  }

  private normalizePlatformUserId(platformUserId: string): string {
    return platformUserId.trim().replace(/\(\d+\)$/, '');
  }

  private normalizeReason(reason?: string): string | null {
    const trimmed = reason?.trim();
    return trimmed ? trimmed.slice(0, 255) : null;
  }

  private normalizeDisplayName(value?: string): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed.slice(0, 255) : null;
  }
}
