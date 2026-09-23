import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StreamPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveChannelOperator } from './chat-permission.helper';

type MockPrisma = {
  userPlatformVerification: { findFirst: jest.Mock };
  liveSession: { findUnique: jest.Mock };
  channel: { findUnique: jest.Mock };
  channelManager: { findUnique: jest.Mock };
};

const buildPrisma = (overrides?: Partial<MockPrisma>): MockPrisma => ({
  userPlatformVerification: {
    findFirst: jest.fn().mockResolvedValue({ userId: 100 }),
  },
  liveSession: {
    findUnique: jest
      .fn()
      .mockResolvedValue({ id: 7, channelId: 42, status: 'ACTIVE' }),
  },
  channel: {
    findUnique: jest.fn().mockResolvedValue({ userId: 100 }),
  },
  channelManager: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
  ...overrides,
});

describe('resolveChannelOperator', () => {
  const baseInput = {
    platform: StreamPlatform.CHZZK,
    platformUserId: 'user-abc',
    sessionId: 7,
  };

  it('owner면 isOwner=true 반환', async () => {
    const prisma = buildPrisma();
    const result = await resolveChannelOperator(
      prisma as unknown as PrismaService,
      { ...baseInput, role: { kind: 'owner-only' } },
    );
    expect(result).toEqual({
      userId: 100,
      channelId: 42,
      sessionId: 7,
      isOwner: true,
    });
  });

  it('SOOP (2)/(3) 접미사 정규화', async () => {
    const prisma = buildPrisma();
    await resolveChannelOperator(prisma as unknown as PrismaService, {
      ...baseInput,
      platform: StreamPlatform.SOOP,
      platformUserId: 'user-abc(2)',
      role: { kind: 'owner-only' },
    });
    expect(prisma.userPlatformVerification.findFirst).toHaveBeenCalledWith({
      where: {
        platform: StreamPlatform.SOOP,
        platformUserId: 'user-abc',
        isVerified: true,
      },
    });
  });

  it('SOOP 외 플랫폼에서는 (n) 접미사 정규화 안 함 (권한 우회 방지)', async () => {
    const prisma = buildPrisma();
    await resolveChannelOperator(prisma as unknown as PrismaService, {
      ...baseInput,
      platform: StreamPlatform.CHZZK,
      platformUserId: 'user-abc(2)',
      role: { kind: 'owner-only' },
    });
    expect(prisma.userPlatformVerification.findFirst).toHaveBeenCalledWith({
      where: {
        platform: StreamPlatform.CHZZK,
        platformUserId: 'user-abc(2)',
        isVerified: true,
      },
    });
  });

  it('UserPlatformVerification 없으면 ForbiddenException', async () => {
    const prisma = buildPrisma({
      userPlatformVerification: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      resolveChannelOperator(prisma as unknown as PrismaService, {
        ...baseInput,
        role: { kind: 'owner-only' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('LiveSession 없거나 ACTIVE 아니면 NotFoundException', async () => {
    const prisma = buildPrisma({
      liveSession: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 7, channelId: 42, status: 'ENDED' }),
      },
    });
    await expect(
      resolveChannelOperator(prisma as unknown as PrismaService, {
        ...baseInput,
        role: { kind: 'owner-only' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Channel 없으면 NotFoundException', async () => {
    const prisma = buildPrisma({
      channel: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      resolveChannelOperator(prisma as unknown as PrismaService, {
        ...baseInput,
        role: { kind: 'owner-only' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('owner-only', () => {
    it('소유자 아니면 매니저 조회 없이 ForbiddenException', async () => {
      const prisma = buildPrisma({
        channel: { findUnique: jest.fn().mockResolvedValue({ userId: 999 }) },
      });
      await expect(
        resolveChannelOperator(prisma as unknown as PrismaService, {
          ...baseInput,
          role: { kind: 'owner-only' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.channelManager.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('owner-or-manager', () => {
    it('isActive=true && permissionKey=true 매니저면 통과 (isOwner=false)', async () => {
      const prisma = buildPrisma({
        channel: { findUnique: jest.fn().mockResolvedValue({ userId: 999 }) },
        channelManager: {
          findUnique: jest.fn().mockResolvedValue({
            isActive: true,
            canManageSettings: true,
            canManageContent: false,
          }),
        },
      });
      const result = await resolveChannelOperator(
        prisma as unknown as PrismaService,
        {
          ...baseInput,
          role: {
            kind: 'owner-or-manager',
            permissionKey: 'canManageSettings',
          },
        },
      );
      expect(result.isOwner).toBe(false);
      expect(result.userId).toBe(100);
    });

    it('isActive=false 매니저면 ForbiddenException', async () => {
      const prisma = buildPrisma({
        channel: { findUnique: jest.fn().mockResolvedValue({ userId: 999 }) },
        channelManager: {
          findUnique: jest.fn().mockResolvedValue({
            isActive: false,
            canManageSettings: true,
          }),
        },
      });
      await expect(
        resolveChannelOperator(prisma as unknown as PrismaService, {
          ...baseInput,
          role: {
            kind: 'owner-or-manager',
            permissionKey: 'canManageSettings',
          },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('permissionKey 권한 없는 매니저면 ForbiddenException', async () => {
      const prisma = buildPrisma({
        channel: { findUnique: jest.fn().mockResolvedValue({ userId: 999 }) },
        channelManager: {
          findUnique: jest.fn().mockResolvedValue({
            isActive: true,
            canManageSettings: false,
            canManageContent: true,
          }),
        },
      });
      await expect(
        resolveChannelOperator(prisma as unknown as PrismaService, {
          ...baseInput,
          role: {
            kind: 'owner-or-manager',
            permissionKey: 'canManageSettings',
          },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('매니저 record 자체가 없으면 ForbiddenException', async () => {
      const prisma = buildPrisma({
        channel: { findUnique: jest.fn().mockResolvedValue({ userId: 999 }) },
        channelManager: { findUnique: jest.fn().mockResolvedValue(null) },
      });
      await expect(
        resolveChannelOperator(prisma as unknown as PrismaService, {
          ...baseInput,
          role: {
            kind: 'owner-or-manager',
            permissionKey: 'canManageContent',
          },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('permissionKey가 다른 키면 그 키로 검사 (canManageContent)', async () => {
      const prisma = buildPrisma({
        channel: { findUnique: jest.fn().mockResolvedValue({ userId: 999 }) },
        channelManager: {
          findUnique: jest.fn().mockResolvedValue({
            isActive: true,
            canManageSettings: false,
            canManageContent: true,
          }),
        },
      });
      const result = await resolveChannelOperator(
        prisma as unknown as PrismaService,
        {
          ...baseInput,
          role: {
            kind: 'owner-or-manager',
            permissionKey: 'canManageContent',
          },
        },
      );
      expect(result.isOwner).toBe(false);
    });
  });
});
