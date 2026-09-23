import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddManagerDto,
  UpdateManagerPermissionsDto,
  ManagerDto,
  ManagerListResponseDto,
  ToggleManagerActiveResponseDto,
} from './dto/channel-manager.dto';

/** 비구독자 최대 활성 매니저 수 */
const MAX_MANAGERS_FREE = 1;
/** 구독자 최대 활성 매니저 수 */
const MAX_MANAGERS_PRO = 10;

@Injectable()
export class ChannelManagerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 채널의 매니저 목록 조회
   */
  async listManagers(
    channelId: number,
    requestUserId: number,
  ): Promise<ManagerListResponseDto> {
    // 채널 및 소유자 정보 조회
    const channel = await this.prisma.channel.findUnique({
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
        managers: {
          select: {
            id: true,
            userId: true,
            isActive: true,
            canManageContent: true,
            canManageSettings: true,
            canManageProfile: true,
            canManageGuestbook: true,
            canManageCustomization: true,
            canManageEmoticons: true,
            canManageHuyeorChat: true,
            createdAt: true,
            revokedAt: true,
            user: {
              select: {
                id: true,
                nickname: true,
                profileImageUrl: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    // 소유자 또는 설정 권한이 있는 매니저만 조회 가능
    await this.validateChannelAccess(channelId, requestUserId, 'settings');

    const isProSubscriber = this.checkProSubscription(channel.user);
    const maxActiveManagers = isProSubscriber
      ? MAX_MANAGERS_PRO
      : MAX_MANAGERS_FREE;
    const activeManagerCount = channel.managers.filter(
      (m) => m.isActive,
    ).length;

    const managers: ManagerDto[] = channel.managers.map((m) => ({
      id: m.id,
      userId: m.userId,
      nickname: m.user.nickname,
      profileImageUrl: m.user.profileImageUrl,
      isActive: m.isActive ?? false,
      canManageContent: m.canManageContent ?? false,
      canManageSettings: m.canManageSettings ?? false,
      canManageProfile: m.canManageProfile ?? false,
      canManageGuestbook: m.canManageGuestbook ?? false,
      canManageCustomization: m.canManageCustomization ?? false,
      canManageEmoticons: m.canManageEmoticons ?? false,
      canManageHuyeorChat: m.canManageHuyeorChat ?? false,
      createdAt: m.createdAt,
      revokedAt: m.revokedAt,
    }));

    return {
      managers,
      maxActiveManagers,
      activeManagerCount,
      isProSubscriber,
    };
  }

  /**
   * 매니저 추가
   */
  async addManager(
    channelId: number,
    requestUserId: number,
    dto: AddManagerDto,
  ): Promise<ManagerDto> {
    const channel = await this.getChannelWithOwnerInfo(channelId);

    // 채널 소유자만 매니저 추가 가능
    if (channel.userId !== requestUserId) {
      throw new ForbiddenException(
        '채널 소유자만 매니저를 추가할 수 있습니다.',
      );
    }

    // 자기 자신을 매니저로 추가할 수 없음
    if (dto.userId === requestUserId) {
      throw new BadRequestException(
        '채널 소유자는 매니저로 추가할 수 없습니다.',
      );
    }

    if (!this.hasAnyPermission(dto)) {
      throw new BadRequestException('최소 하나의 권한이 필요합니다.');
    }

    // 이미 매니저인지 확인
    const existingManager = await this.prisma.channelManager.findUnique({
      where: { channelId_userId: { channelId, userId: dto.userId } },
    });

    if (existingManager) {
      throw new BadRequestException('이미 등록된 매니저입니다.');
    }

    // 대상 사용자 존재 확인
    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, nickname: true, profileImageUrl: true },
    });

    if (!targetUser) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    // 구독 상태 확인
    const isProSubscriber = this.checkProSubscription(channel.user);
    if (dto.canManageCustomization === true && !isProSubscriber) {
      throw new BadRequestException(
        '커스터마이징 권한은 PRO 구독 채널에서만 부여할 수 있습니다.',
      );
    }
    const maxActiveManagers = isProSubscriber
      ? MAX_MANAGERS_PRO
      : MAX_MANAGERS_FREE;

    // 현재 활성 매니저 수 확인
    const activeManagerCount = await this.prisma.channelManager.count({
      where: { channelId, isActive: true },
    });

    // 새 매니저의 활성 상태 결정 (제한에 걸리면 비활성으로 추가)
    const shouldBeActive = activeManagerCount < maxActiveManagers;

    const manager = await this.prisma.channelManager.create({
      data: {
        channelId,
        userId: dto.userId,
        grantedByUserId: requestUserId,
        isActive: shouldBeActive,
        canManageContent: dto.canManageContent ?? false,
        canManageSettings: dto.canManageSettings ?? false,
        canManageProfile: dto.canManageProfile ?? false,
        canManageGuestbook: dto.canManageGuestbook ?? false,
        canManageCustomization: dto.canManageCustomization ?? false,
        canManageEmoticons: dto.canManageEmoticons ?? false,
        canManageHuyeorChat: dto.canManageHuyeorChat ?? false,
      },
    });

    return {
      id: manager.id,
      userId: manager.userId,
      nickname: targetUser.nickname,
      profileImageUrl: targetUser.profileImageUrl,
      isActive: manager.isActive ?? false,
      canManageContent: manager.canManageContent ?? false,
      canManageSettings: manager.canManageSettings ?? false,
      canManageProfile: manager.canManageProfile ?? false,
      canManageGuestbook: manager.canManageGuestbook ?? false,
      canManageCustomization: manager.canManageCustomization ?? false,
      canManageEmoticons: manager.canManageEmoticons ?? false,
      canManageHuyeorChat: manager.canManageHuyeorChat ?? false,
      createdAt: manager.createdAt,
      revokedAt: manager.revokedAt,
    };
  }

  /**
   * 매니저 활성화/비활성화 토글
   */
  async toggleManagerActive(
    channelId: number,
    managerId: number,
    requestUserId: number,
    isActive: boolean,
  ): Promise<ToggleManagerActiveResponseDto> {
    const channel = await this.getChannelWithOwnerInfo(channelId);

    // 채널 소유자만 매니저 활성화/비활성화 가능
    if (channel.userId !== requestUserId) {
      throw new ForbiddenException(
        '채널 소유자만 매니저를 활성화/비활성화할 수 있습니다.',
      );
    }

    // 매니저 존재 확인
    const manager = await this.prisma.channelManager.findFirst({
      where: { id: managerId, channelId },
    });

    if (!manager) {
      throw new NotFoundException('매니저를 찾을 수 없습니다.');
    }

    // 이미 같은 상태면 바로 반환
    if (manager.isActive === isActive) {
      return {
        id: manager.id,
        isActive: manager.isActive ?? false,
        deactivatedManagerId: null,
      };
    }

    let deactivatedManagerId: number | null = null;

    // 활성화 요청인 경우
    if (isActive) {
      const isProSubscriber = this.checkProSubscription(channel.user);
      const maxActiveManagers = isProSubscriber
        ? MAX_MANAGERS_PRO
        : MAX_MANAGERS_FREE;

      // 현재 활성 매니저 수 확인
      const activeManagers = await this.prisma.channelManager.findMany({
        where: { channelId, isActive: true },
        orderBy: { createdAt: 'asc' },
      });

      // 비구독자이고 이미 활성 매니저가 있으면 기존 매니저 비활성화
      if (!isProSubscriber && activeManagers.length >= maxActiveManagers) {
        // 가장 오래된 활성 매니저 비활성화
        const managerToDeactivate = activeManagers[0];

        await this.prisma.channelManager.update({
          where: { id: managerToDeactivate.id },
          data: { isActive: false, revokedAt: new Date() },
        });

        deactivatedManagerId = managerToDeactivate.id;
      } else if (
        isProSubscriber &&
        activeManagers.length >= maxActiveManagers
      ) {
        throw new BadRequestException(
          `최대 ${maxActiveManagers}명까지만 활성화할 수 있습니다.`,
        );
      }
    }

    // 매니저 상태 업데이트
    const updatedManager = await this.prisma.channelManager.update({
      where: { id: managerId },
      data: {
        isActive,
        revokedAt: isActive ? null : new Date(),
      },
    });

    return {
      id: updatedManager.id,
      isActive: updatedManager.isActive ?? false,
      deactivatedManagerId,
    };
  }

  /**
   * 매니저 권한 수정
   */
  async updateManagerPermissions(
    channelId: number,
    managerId: number,
    requestUserId: number,
    dto: UpdateManagerPermissionsDto,
  ): Promise<ManagerDto> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
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

    // 채널 소유자만 권한 수정 가능
    if (channel.userId !== requestUserId) {
      throw new ForbiddenException(
        '채널 소유자만 매니저 권한을 수정할 수 있습니다.',
      );
    }

    // 매니저 존재 확인
    const manager = await this.prisma.channelManager.findFirst({
      where: { id: managerId, channelId },
    });

    if (!manager) {
      throw new NotFoundException('매니저를 찾을 수 없습니다.');
    }

    const nextPermissions = {
      canManageContent: dto.canManageContent ?? manager.canManageContent,
      canManageSettings: dto.canManageSettings ?? manager.canManageSettings,
      canManageProfile: dto.canManageProfile ?? manager.canManageProfile,
      canManageGuestbook: dto.canManageGuestbook ?? manager.canManageGuestbook,
      canManageCustomization:
        dto.canManageCustomization ?? manager.canManageCustomization,
      canManageEmoticons: dto.canManageEmoticons ?? manager.canManageEmoticons,
      canManageHuyeorChat:
        dto.canManageHuyeorChat ?? manager.canManageHuyeorChat,
    };

    if (!this.hasAnyPermission(nextPermissions)) {
      throw new BadRequestException('최소 하나의 권한이 필요합니다.');
    }

    if (
      nextPermissions.canManageCustomization === true &&
      !this.checkProSubscription(channel.user)
    ) {
      throw new BadRequestException(
        '커스터마이징 권한은 PRO 구독 채널에서만 부여할 수 있습니다.',
      );
    }

    const updatedManager = await this.prisma.channelManager.update({
      where: { id: managerId },
      data: nextPermissions,
    });

    // 사용자 정보 조회
    const user = await this.prisma.user.findUnique({
      where: { id: updatedManager.userId },
      select: { nickname: true, profileImageUrl: true },
    });

    return {
      id: updatedManager.id,
      userId: updatedManager.userId,
      nickname: user?.nickname ?? '',
      profileImageUrl: user?.profileImageUrl ?? null,
      isActive: updatedManager.isActive ?? false,
      canManageContent: updatedManager.canManageContent ?? false,
      canManageSettings: updatedManager.canManageSettings ?? false,
      canManageProfile: updatedManager.canManageProfile ?? false,
      canManageGuestbook: updatedManager.canManageGuestbook ?? false,
      canManageCustomization: updatedManager.canManageCustomization ?? false,
      canManageEmoticons: updatedManager.canManageEmoticons ?? false,
      canManageHuyeorChat: updatedManager.canManageHuyeorChat ?? false,
      createdAt: updatedManager.createdAt,
      revokedAt: updatedManager.revokedAt,
    };
  }

  /**
   * 매니저 삭제
   */
  async removeManager(
    channelId: number,
    managerId: number,
    requestUserId: number,
  ): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    // 채널 소유자만 매니저 삭제 가능
    if (channel.userId !== requestUserId) {
      throw new ForbiddenException(
        '채널 소유자만 매니저를 삭제할 수 있습니다.',
      );
    }

    // 매니저 존재 확인
    const manager = await this.prisma.channelManager.findFirst({
      where: { id: managerId, channelId },
    });

    if (!manager) {
      throw new NotFoundException('매니저를 찾을 수 없습니다.');
    }

    await this.prisma.channelManager.delete({
      where: { id: managerId },
    });
  }

  // ==================== Private Helper Methods ====================

  private async getChannelWithOwnerInfo(channelId: number) {
    const channel = await this.prisma.channel.findUnique({
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

    return channel;
  }

  private checkProSubscription(user: {
    isProSubscriber: boolean | null;
    proSubscriptionEndAt: Date | null;
  }): boolean {
    if (!user.isProSubscriber) return false;
    if (!user.proSubscriptionEndAt) return false;
    return user.proSubscriptionEndAt > new Date();
  }

  private hasAnyPermission(permissions: {
    canManageContent?: boolean | null;
    canManageSettings?: boolean | null;
    canManageProfile?: boolean | null;
    canManageGuestbook?: boolean | null;
    canManageCustomization?: boolean | null;
    canManageEmoticons?: boolean | null;
    canManageHuyeorChat?: boolean | null;
  }): boolean {
    return Boolean(
      permissions.canManageContent ||
        permissions.canManageSettings ||
        permissions.canManageProfile ||
        permissions.canManageGuestbook ||
        permissions.canManageCustomization ||
        permissions.canManageEmoticons ||
        permissions.canManageHuyeorChat,
    );
  }

  private async validateChannelAccess(
    channelId: number,
    userId: number,
    permission:
      | 'settings'
      | 'content'
      | 'profile'
      | 'guestbook'
      | 'customization'
      | 'emoticons',
  ): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    // 소유자는 항상 접근 가능
    if (channel.userId === userId) {
      return;
    }

    // 매니저 권한 확인
    const manager = await this.prisma.channelManager.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: {
        isActive: true,
        canManageContent: true,
        canManageSettings: true,
        canManageProfile: true,
        canManageGuestbook: true,
        canManageCustomization: true,
        canManageEmoticons: true,
      },
    });

    if (!manager?.isActive) {
      throw new ForbiddenException('접근 권한이 없습니다.');
    }

    const permissionMap = {
      settings: manager.canManageSettings,
      content: manager.canManageContent,
      profile: manager.canManageProfile,
      guestbook: manager.canManageGuestbook,
      customization: manager.canManageCustomization,
      emoticons: manager.canManageEmoticons,
    };

    if (!permissionMap[permission]) {
      throw new ForbiddenException('해당 기능에 대한 권한이 없습니다.');
    }
  }
}
