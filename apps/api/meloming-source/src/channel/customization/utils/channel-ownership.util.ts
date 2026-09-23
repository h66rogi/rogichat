import { PrismaService } from '../../../prisma/prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChannelService } from '../../channel.service';
import { ChannelManagerPermissions } from '../../types/manager-permissions.type';

/**
 * 채널 커스터마이징 조회 권한 확인 (Preview 모드 지원)
 * - 소유자: Pro 구독 여부와 관계없이 조회 가능
 * - 매니저: 채널 소유자가 Pro 구독자일 때만 조회 가능
 *
 * @param prisma PrismaService 인스턴스
 * @param channelService ChannelService 인스턴스
 * @param channelId 채널 ID
 * @param userId 사용자 ID (요청자)
 * @returns { isOwner, isOwnerPro } 소유자 여부와 소유자의 Pro 구독 여부
 * @throws ForbiddenException 권한이 없는 경우
 * @throws NotFoundException 채널을 찾을 수 없는 경우
 */
export async function assertCustomizationViewAccess(
  prisma: PrismaService,
  channelService: ChannelService,
  channelId: number,
  userId: number,
): Promise<{ isOwner: boolean; isOwnerPro: boolean }> {
  // 1. 채널 및 소유자 정보 조회
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          isProSubscriber: true,
          proSubscriptionEndAt: true,
        },
      },
    },
  });

  if (!channel) {
    throw new NotFoundException('채널을 찾을 수 없습니다.');
  }

  const owner = channel.user;
  const isOwner = channel.userId === userId;

  // Pro 구독 상태 확인 (만료 여부 포함)
  let isOwnerPro = false;
  if (owner?.isProSubscriber) {
    if (owner.proSubscriptionEndAt) {
      isOwnerPro = owner.proSubscriptionEndAt > new Date();
    } else {
      isOwnerPro = true;
    }
  }

  // 2. 소유자인 경우: Pro 여부와 관계없이 조회 허용
  if (isOwner) {
    return { isOwner: true, isOwnerPro };
  }

  // 3. 매니저인 경우: 소유자가 Pro일 때만 허용
  const manager: ChannelManagerPermissions =
    await channelService.getManagerPermissions(channelId, userId);
  const hasManagerPermission =
    manager?.isActive === true && manager.canManageCustomization === true;

  if (hasManagerPermission) {
    if (!isOwnerPro) {
      throw new ForbiddenException(
        '채널 소유자가 프로 구독자여야 사용할 수 있는 기능입니다. 채널 소유자에게 PRO 구독을 권유해보세요.',
      );
    }
    return { isOwner: false, isOwnerPro: true };
  }

  // 4. 소유자도 매니저도 아닌 경우
  throw new ForbiddenException(
    '해당 채널의 소유자이거나 커스텀 CSS 관리 권한을 가진 매니저만 사용할 수 있습니다.',
  );
}

/**
 * 채널 커스터마이징 관리 권한 확인 (PRO 구독 요구 없음)
 * - 소유자: 허용
 * - 매니저: canManageCustomization 권한이 있으면 허용
 *
 * @param prisma PrismaService 인스턴스
 * @param channelService ChannelService 인스턴스
 * @param channelId 채널 ID
 * @param userId 사용자 ID (요청자)
 * @returns { isOwner, isOwnerPro } 소유자 여부와 소유자의 Pro 구독 여부
 * @throws ForbiddenException 권한이 없는 경우
 * @throws NotFoundException 채널을 찾을 수 없는 경우
 */
export async function assertCustomizationManageAccess(
  prisma: PrismaService,
  channelService: ChannelService,
  channelId: number,
  userId: number,
): Promise<{ isOwner: boolean; isOwnerPro: boolean }> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          isProSubscriber: true,
          proSubscriptionEndAt: true,
        },
      },
    },
  });

  if (!channel) {
    throw new NotFoundException('채널을 찾을 수 없습니다.');
  }

  const owner = channel.user;
  const isOwner = channel.userId === userId;

  let isOwnerPro = false;
  if (owner?.isProSubscriber) {
    if (owner.proSubscriptionEndAt) {
      isOwnerPro = owner.proSubscriptionEndAt > new Date();
    } else {
      isOwnerPro = true;
    }
  }

  if (isOwner) {
    return { isOwner: true, isOwnerPro };
  }

  const manager: ChannelManagerPermissions =
    await channelService.getManagerPermissions(channelId, userId);
  const hasManagerPermission =
    manager?.isActive === true && manager.canManageCustomization === true;

  if (hasManagerPermission) {
    return { isOwner: false, isOwnerPro };
  }

  throw new ForbiddenException(
    '해당 채널의 소유자이거나 커스텀 CSS 관리 권한을 가진 매니저만 사용할 수 있습니다.',
  );
}

/**
 * 프로 구독자 + 채널 소유자 또는 매니저 확인
 * 커스텀 CSS를 적용하려면:
 * 1. 채널 소유자가 프로 구독자여야 함
 * 2. 요청자가 채널 소유자이거나 canManageCustomization 권한을 가진 매니저여야 함
 *
 * @param prisma PrismaService 인스턴스
 * @param channelService ChannelService 인스턴스
 * @param channelId 채널 ID
 * @param userId 사용자 ID (요청자)
 * @throws ForbiddenException 프로 구독자가 아니거나 권한이 없는 경우
 * @throws NotFoundException 채널을 찾을 수 없는 경우
 */
export async function assertProSubscriberAndChannelOwner(
  prisma: PrismaService,
  channelService: ChannelService,
  channelId: number,
  userId: number,
): Promise<void> {
  // 1. 채널 및 소유자 정보 조회
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          isProSubscriber: true,
          proSubscriptionEndAt: true,
        },
      },
    },
  });

  if (!channel) {
    throw new NotFoundException('채널을 찾을 수 없습니다.');
  }

  // 2. 채널 소유자가 프로 구독자인지 확인
  const owner = channel.user;
  if (!owner?.isProSubscriber) {
    throw new ForbiddenException(
      '채널 소유자가 프로 구독자여야 사용할 수 있는 기능입니다.',
    );
  }

  // 3. 구독 만료일 확인 (채널 소유자 기준)
  if (owner.proSubscriptionEndAt) {
    const now = new Date();
    if (owner.proSubscriptionEndAt <= now) {
      throw new ForbiddenException(
        '채널 소유자의 프로 구독이 만료되었습니다. 구독을 갱신해주세요.',
      );
    }
  }

  // 4. 채널 소유자 확인
  const isOwner = channel.userId === userId;

  // 5. 매니저 권한 확인 (소유자가 아닌 경우)
  let hasManagerPermission = false;
  if (!isOwner) {
    const manager: ChannelManagerPermissions =
      await channelService.getManagerPermissions(channelId, userId);
    hasManagerPermission =
      manager?.isActive === true && manager.canManageCustomization === true;
  }

  // 소유자도 매니저도 아닌 경우
  if (!isOwner && !hasManagerPermission) {
    throw new ForbiddenException(
      '해당 채널의 소유자이거나 커스텀 CSS 관리 권한을 가진 매니저만 사용할 수 있습니다.',
    );
  }
}
