import {
  ChannelVerification,
  ChannelVerificationLog,
  Channel,
  User,
} from '@prisma/client';
import {
  ChannelVerificationDto,
  ChannelVerificationLogDto,
  ChannelVerificationDetailDto,
} from '../dto/channel-verification.response.dto';
import {
  AdminChannelVerificationListItemDto,
  AdminChannelVerificationDetailDto,
} from '../admin/dto/admin-channel-verification.dto';

/**
 * ChannelVerification -> ChannelVerificationDto 변환
 */
export function toChannelVerificationDto(
  entity: ChannelVerification,
): ChannelVerificationDto {
  return {
    id: entity.id,
    channelId: entity.channelId,
    platform: entity.platform,
    platformChannelId: entity.platformChannelId,
    status: entity.status,
    pendingReason: entity.pendingReason,
    evidenceImageUrl: entity.evidenceImageUrl,
    evidenceDescription: entity.evidenceDescription,
    rejectionReason: entity.rejectionReason,
    reviewedAt: entity.reviewedAt,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

/**
 * ChannelVerificationLog -> ChannelVerificationLogDto 변환
 */
export function toChannelVerificationLogDto(
  entity: ChannelVerificationLog,
): ChannelVerificationLogDto {
  return {
    id: entity.id,
    action: entity.action,
    previousStatus: entity.previousStatus,
    newStatus: entity.newStatus,
    actorUserId: entity.actorUserId,
    actorType: entity.actorType,
    reason: entity.reason,
    createdAt: entity.createdAt,
  };
}

/**
 * ChannelVerification with logs -> ChannelVerificationDetailDto 변환
 */
export function toChannelVerificationDetailDto(
  entity: ChannelVerification & { logs: ChannelVerificationLog[] },
): ChannelVerificationDetailDto {
  return {
    ...toChannelVerificationDto(entity),
    logs: entity.logs.map(toChannelVerificationLogDto),
  };
}

type ChannelVerificationWithRelations = ChannelVerification & {
  channel: Pick<Channel, 'id' | 'name' | 'webPath' | 'platformUrl'>;
  user: Pick<User, 'id' | 'nickname' | 'email'>;
};

/**
 * Admin: ChannelVerification with relations -> AdminChannelVerificationListItemDto 변환
 */
export function toAdminChannelVerificationListItemDto(
  entity: ChannelVerificationWithRelations,
): AdminChannelVerificationListItemDto {
  return {
    ...toChannelVerificationDto(entity),
    channel: {
      id: entity.channel.id,
      name: entity.channel.name,
      webPath: entity.channel.webPath,
      platformUrl: entity.channel.platformUrl,
    },
    user: {
      id: entity.user.id,
      nickname: entity.user.nickname,
      email: entity.user.email,
    },
  };
}

type ChannelVerificationWithFullRelations = ChannelVerificationWithRelations & {
  reviewedByUser: Pick<User, 'id' | 'nickname'> | null;
  logs: (ChannelVerificationLog & {
    actorUser: Pick<User, 'id' | 'nickname'> | null;
  })[];
};

/**
 * Admin: ChannelVerification with full relations -> AdminChannelVerificationDetailDto 변환
 */
export function toAdminChannelVerificationDetailDto(
  entity: ChannelVerificationWithFullRelations,
): AdminChannelVerificationDetailDto {
  return {
    ...toAdminChannelVerificationListItemDto(entity),
    reviewedByUser: entity.reviewedByUser
      ? {
          id: entity.reviewedByUser.id,
          nickname: entity.reviewedByUser.nickname,
        }
      : null,
    logs: entity.logs.map((log) => ({
      id: log.id,
      action: log.action,
      previousStatus: log.previousStatus,
      newStatus: log.newStatus,
      actorUserId: log.actorUserId,
      actorType: log.actorType,
      reason: log.reason,
      createdAt: log.createdAt,
      actorUser: log.actorUser
        ? {
            id: log.actorUser.id,
            nickname: log.actorUser.nickname,
          }
        : null,
    })),
  };
}
