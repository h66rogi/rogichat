import { PrismaService } from '../../../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';

/**
 * 프로 구독자 활성 상태 확인
 * @param prisma PrismaService 인스턴스
 * @param userId 사용자 ID
 * @returns 프로 구독자 활성 여부
 */
export async function isProSubscriberActive(
  prisma: PrismaService,
  userId: number,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isProSubscriber: true,
      proSubscriptionEndAt: true,
    },
  });

  if (!user?.isProSubscriber) {
    return false;
  }

  // 만료일 확인
  if (user.proSubscriptionEndAt) {
    return user.proSubscriptionEndAt > new Date();
  }

  return true;
}

/**
 * 프로 구독자 확인 및 예외 발생
 * @param prisma PrismaService 인스턴스
 * @param userId 사용자 ID
 * @throws ForbiddenException 프로 구독자가 아닌 경우
 */
export async function assertProSubscriber(
  prisma: PrismaService,
  userId: number,
): Promise<void> {
  const isActive = await isProSubscriberActive(prisma, userId);
  if (!isActive) {
    throw new ForbiddenException('프로 구독자만 사용할 수 있는 기능입니다.');
  }
}
