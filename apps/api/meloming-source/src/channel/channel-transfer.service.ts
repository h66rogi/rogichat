import {
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import {
  RequestTransferDto,
  AcceptTransferDto,
} from './dto/channel-transfer.request.dto';
import {
  ResourceNotFoundException,
  InvalidInputException,
} from '../common/exceptions/custom.exception';
import * as crypto from 'crypto';
import { TransactionalEmailService } from '../transactional-email/transactional-email.service';
import { emailHashHex } from '../transactional-email/lib/email-hash';
import {
  getChannelTransferConfirmTemplate,
  getChannelTransferResultTemplate,
} from '../transactional-email/templates';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';
import {
  Prisma,
  ChannelTransferStatus,
  ChannelTransferAction,
  ChannelTransferActorType,
  ChannelVerificationStatus,
  ChannelVerificationAction,
  ChannelVerificationActorType,
} from '@prisma/client';
import {
  ChannelTransferIncomingListResponseDto,
  ChannelTransferOutgoingResponseDto,
  MessageResponseDto,
  TransferTargetInfoDto,
} from './dto/channel.response.dto';
import { TalkV2Service } from '../talk-v2/talk-v2.service';
import { ReferralCodeService } from '../referral/referral-code.service';

const REMIND_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Rate limit constants for transfer target check
const TRANSFER_TARGET_CHECK_LIMIT = 10; // 10 requests
const TRANSFER_TARGET_CHECK_WINDOW_SEC = 30 * 60; // 30 minutes

@Injectable()
export class ChannelTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionalEmail: TransactionalEmailService,
    private readonly distributedLockService: DistributedLockService,
    private readonly talkV2: TalkV2Service,
    private readonly referralCodes: ReferralCodeService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}
  private readonly logger = new Logger(ChannelTransferService.name);

  /**
   * Rate limit check for transfer target lookup
   * @throws InvalidInputException if rate limit exceeded
   */
  private async checkRateLimit(userId: number): Promise<void> {
    const key = `transfer-target-check:${userId}`;
    const current = await this.cacheManager.get<number>(key);
    const count = current ?? 0;

    if (count >= TRANSFER_TARGET_CHECK_LIMIT) {
      throw new InvalidInputException(
        '너무 많이 시도했습니다. 잠시 후 다시 시도해주세요.',
      );
    }

    await this.cacheManager.set(
      key,
      count + 1,
      TRANSFER_TARGET_CHECK_WINDOW_SEC * 1000,
    );
  }

  private async assertTargetEligibility(targetUserId: number) {
    const [ownsChannel, pendingRequest] = await Promise.all([
      this.prisma.channel.count({
        where: { userId: targetUserId },
      }),
      this.prisma.channelTransferRequest.findFirst({
        where: {
          targetUserId,
          status: {
            in: [
              ChannelTransferStatus.PENDING,
              ChannelTransferStatus.CONFIRMED,
            ],
          },
        },
        select: { id: true },
      }),
    ]);

    if (ownsChannel > 0) {
      throw new InvalidInputException(
        '대상 사용자가 이미 채널을 보유하고 있습니다.',
      );
    }
    if (pendingRequest) {
      throw new InvalidInputException(
        '대상 사용자는 이미 다른 채널 이전 요청을 대기 중입니다.',
      );
    }
  }

  async checkTransferTarget(
    email: string,
    requesterUserId: number,
  ): Promise<TransferTargetInfoDto> {
    // Rate limit check
    await this.checkRateLimit(requesterUserId);

    const normalizedEmail = email.trim().toLowerCase();
    const target = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        email: true,
        nickname: true,
        profileImageUrl: true,
      },
    });
    if (!target) {
      throw new ResourceNotFoundException('대상 사용자를 찾을 수 없습니다.');
    }
    if (target.id === requesterUserId) {
      throw new InvalidInputException('본인을 대상자로 지정할 수 없습니다.');
    }

    await this.assertTargetEligibility(target.id);

    return {
      userId: target.id,
      email: target.email,
      nickname: target.nickname,
      profileImageUrl: target.profileImageUrl,
    };
  }

  async requestTransfer(
    channelId: number,
    requesterUserId: number,
    dto: RequestTransferDto,
  ): Promise<{ requestId: number; status: 'PENDING' }> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, userId: true, name: true },
    });
    if (!channel)
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    if (channel.userId !== requesterUserId) throw new UnauthorizedException();

    const inProgress = await this.prisma.channelTransferRequest.findFirst({
      where: {
        channelId,
        status: {
          in: [ChannelTransferStatus.PENDING, ChannelTransferStatus.CONFIRMED],
        },
      },
      select: { id: true },
    });
    if (inProgress)
      throw new InvalidInputException('기존 진행 중인 이전 요청이 있습니다.');

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.targetUserId },
      select: {
        id: true,
        email: true,
        nickname: true,
        profileImageUrl: true,
      },
    });
    if (!targetUser?.email) {
      throw new ResourceNotFoundException('대상 사용자를 찾을 수 없습니다.');
    }
    if (targetUser.id === requesterUserId) {
      throw new InvalidInputException('본인을 대상자로 지정할 수 없습니다.');
    }

    await this.assertTargetEligibility(targetUser.id);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterUserId },
      select: { nickname: true },
    });

    const created = await this.prisma.channelTransferRequest.create({
      data: {
        channelId,
        currentOwnerUserId: requesterUserId,
        targetEmail: targetUser.email,
        targetUserId: targetUser.id,
        status: ChannelTransferStatus.PENDING,
        submitToken: token,
        submitTokenExpiresAt: expiresAt,
        noteFromRequester: dto.noteFromRequester ?? null,
        lastNotifiedAt: new Date(),
      },
      select: { id: true },
    });

    // send email to target
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const confirmUrl = `${baseUrl}/channel/transfer/requests/${created.id}?token=${token}`;
    await this.transactionalEmail.enqueue({
      service: 'channel',
      event: 'transfer-confirm',
      to: targetUser.email,
      subject: '[멜로밍] 채널 이전 확인 안내',
      html: getChannelTransferConfirmTemplate(
        requester?.nickname || '채널 소유주',
        targetUser.email,
        confirmUrl,
        expiresAt.toISOString(),
      ),
      idempotencyKey: `channel-transfer:${created.id}:confirm`,
    });

    return { requestId: created.id, status: 'PENDING' };
  }

  async remindTransfer(
    requestId: number,
    requesterUserId: number,
  ): Promise<MessageResponseDto> {
    const request = await this.prisma.channelTransferRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        currentOwnerUserId: true,
        status: true,
        targetEmail: true,
        submitToken: true,
        submitTokenExpiresAt: true,
        lastNotifiedAt: true,
      },
    });
    if (!request) {
      throw new ResourceNotFoundException('요청을 찾을 수 없습니다.');
    }
    if (request.currentOwnerUserId !== requesterUserId) {
      throw new UnauthorizedException();
    }
    if (request.status !== ChannelTransferStatus.PENDING) {
      throw new InvalidInputException('이미 처리된 요청입니다.');
    }
    if (
      request.lastNotifiedAt &&
      Date.now() - request.lastNotifiedAt.getTime() < REMIND_INTERVAL_MS
    ) {
      throw new InvalidInputException(
        '재알림은 24시간에 한 번만 전송할 수 있습니다.',
      );
    }

    const notifiedAt = new Date();
    const notifiedAtMs = notifiedAt.getTime();
    await this.prisma.channelTransferRequest.update({
      where: { id: requestId },
      data: { lastNotifiedAt: notifiedAt },
    });

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterUserId },
      select: { nickname: true },
    });
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const confirmUrl = `${baseUrl}/channel/transfer/requests/${request.id}?token=${request.submitToken}`;
    await this.transactionalEmail.enqueue({
      service: 'channel',
      event: 'transfer-remind',
      to: request.targetEmail,
      subject: '[멜로밍] 채널 이전 재알림',
      html: getChannelTransferConfirmTemplate(
        requester?.nickname || '채널 소유주',
        request.targetEmail,
        confirmUrl,
        request.submitTokenExpiresAt.toISOString(),
      ),
      idempotencyKey: `channel-transfer:${request.id}:remind:${notifiedAtMs}`,
    });

    return { message: '재알림을 전송했습니다.' };
  }

  async cancelTransfer(
    requestId: number,
    requesterUserId: number,
  ): Promise<MessageResponseDto> {
    const request = await this.prisma.channelTransferRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        currentOwnerUserId: true,
        channelId: true,
        targetEmail: true,
      },
    });
    if (!request) {
      throw new ResourceNotFoundException('요청을 찾을 수 없습니다.');
    }
    if (request.currentOwnerUserId !== requesterUserId) {
      throw new UnauthorizedException();
    }
    if (request.status !== ChannelTransferStatus.PENDING) {
      throw new InvalidInputException('이미 처리된 요청입니다.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.channelTransferRequest.update({
        where: { id: requestId },
        data: {
          status: ChannelTransferStatus.CANCELED,
        },
      });
      await tx.channelTransferAudit.create({
        data: {
          requestId,
          action: ChannelTransferAction.cancel,
          actorType: ChannelTransferActorType.user,
          actorUserId: requesterUserId,
          memo: '요청자가 취소했습니다.',
        },
      });
    });

    try {
      const channel = await this.prisma.channel.findUnique({
        where: { id: request.channelId },
        select: { name: true },
      });
      await this.transactionalEmail.enqueue({
        service: 'channel',
        event: 'transfer-cancel',
        to: request.targetEmail,
        subject: '[멜로밍] 채널 이전 신청이 취소되었습니다',
        html: getChannelTransferResultTemplate(
          false,
          channel?.name || '',
          '채널 소유자가 요청을 취소했습니다.',
        ),
        idempotencyKey: `channel-transfer:${request.id}:cancel`,
      });
    } catch (e) {
      this.logger.warn(
        `Failed to send cancellation email for request ${requestId}`,
        e instanceof Error ? e.message : String(e),
      );
    }

    return { message: '채널 이전 요청을 취소했습니다.' };
  }

  async rejectTransfer(
    requestId: number,
    userId: number,
  ): Promise<MessageResponseDto> {
    const request = await this.prisma.channelTransferRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        targetUserId: true,
        currentOwnerUserId: true,
        channelId: true,
      },
    });
    if (!request) {
      throw new ResourceNotFoundException('요청을 찾을 수 없습니다.');
    }
    if (request.targetUserId !== userId) {
      throw new UnauthorizedException();
    }
    if (request.status !== ChannelTransferStatus.PENDING) {
      throw new InvalidInputException('이미 처리된 요청입니다.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.channelTransferRequest.update({
        where: { id: requestId },
        data: {
          status: ChannelTransferStatus.REJECTED,
          reviewedAt: new Date(),
        },
      });
      await tx.channelTransferAudit.create({
        data: {
          requestId,
          action: ChannelTransferAction.reject,
          actorType: ChannelTransferActorType.user,
          actorUserId: userId,
          memo: '수신자가 거절했습니다.',
        },
      });
    });

    // Send rejection notification to requester
    try {
      const [channel, requester] = await Promise.all([
        this.prisma.channel.findUnique({
          where: { id: request.channelId },
          select: { name: true },
        }),
        this.prisma.user.findUnique({
          where: { id: request.currentOwnerUserId },
          select: { email: true },
        }),
      ]);
      if (requester?.email) {
        await this.transactionalEmail.enqueue({
          service: 'channel',
          event: 'transfer-reject',
          to: requester.email,
          subject: '[멜로밍] 채널 이전 요청이 거절되었습니다',
          html: getChannelTransferResultTemplate(
            false,
            channel?.name || '',
            '수신자가 채널 이전 요청을 거절했습니다.',
          ),
          idempotencyKey: `channel-transfer:${request.id}:reject`,
        });
      }
    } catch (e) {
      this.logger.warn(
        `Failed to send rejection email for request ${requestId}`,
        e instanceof Error ? e.message : String(e),
      );
    }

    return { message: '채널 이전 요청을 거절했습니다.' };
  }

  async validateTransferToken(
    requestId: number,
    token: string,
  ): Promise<{ valid: boolean }> {
    const request = await this.prisma.channelTransferRequest.findUnique({
      where: { id: requestId },
      select: {
        submitToken: true,
        submitTokenExpiresAt: true,
        status: true,
      },
    });

    if (!request) {
      return { valid: false };
    }

    if (request.status !== ChannelTransferStatus.PENDING) {
      return { valid: false };
    }

    if (request.submitToken !== token) {
      return { valid: false };
    }

    if (
      request.submitTokenExpiresAt &&
      request.submitTokenExpiresAt < new Date()
    ) {
      return { valid: false };
    }

    return { valid: true };
  }

  async getIncomingTransfers(
    userId: number,
  ): Promise<ChannelTransferIncomingListResponseDto> {
    const rows = await this.prisma.channelTransferRequest.findMany({
      where: {
        targetUserId: userId,
        status: ChannelTransferStatus.PENDING,
      },
      select: {
        id: true,
        noteFromRequester: true,
        createdAt: true,
        lastNotifiedAt: true,
        channel: {
          select: {
            id: true,
            name: true,
            profileImageUrl: true,
            webPath: true,
          },
        },
        currentOwnerUser: {
          select: {
            id: true,
            nickname: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      requests: rows.map((row) => ({
        requestId: row.id,
        noteFromRequester: row.noteFromRequester,
        requestedAt: row.createdAt ?? new Date(),
        lastNotifiedAt: row.lastNotifiedAt ?? row.createdAt ?? new Date(),
        channel: {
          id: row.channel.id,
          name: row.channel.name,
          profileImageUrl: row.channel.profileImageUrl,
          webPath: row.channel.webPath,
        },
        currentOwner: {
          id: row.currentOwnerUser.id,
          nickname: row.currentOwnerUser.nickname,
        },
      })),
    };
  }

  async getOutgoingTransfer(
    channelId: number,
    requesterUserId: number,
  ): Promise<ChannelTransferOutgoingResponseDto | null> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true },
    });
    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }
    if (channel.userId !== requesterUserId) {
      throw new UnauthorizedException();
    }

    const request = await this.prisma.channelTransferRequest.findFirst({
      where: {
        channelId,
        status: ChannelTransferStatus.PENDING,
      },
      select: {
        id: true,
        noteFromRequester: true,
        createdAt: true,
        lastNotifiedAt: true,
        targetUserId: true,
        targetEmail: true,
      },
    });

    if (!request) {
      return null;
    }

    const targetUser = request.targetUserId
      ? await this.prisma.user.findUnique({
          where: { id: request.targetUserId },
          select: {
            id: true,
            email: true,
            nickname: true,
            profileImageUrl: true,
          },
        })
      : null;

    return {
      requestId: request.id,
      target: {
        id: targetUser?.id ?? 0,
        email: targetUser?.email ?? request.targetEmail,
        nickname: targetUser?.nickname ?? null,
        profileImageUrl: targetUser?.profileImageUrl ?? null,
      },
      noteFromRequester: request.noteFromRequester,
      requestedAt: request.createdAt ?? new Date(),
      lastNotifiedAt: request.lastNotifiedAt ?? request.createdAt ?? new Date(),
    };
  }

  async acceptTransfer(
    requestId: number,
    dto: AcceptTransferDto,
    userId: number,
  ): Promise<{ requestId: number; status: 'COMPLETED' }> {
    const lockKey = `lock:channel:transfer:${requestId}`;
    const acquired = await this.distributedLockService.acquireLock(
      lockKey,
      30_000,
    );
    if (!acquired)
      throw new InvalidInputException('다른 승인 작업이 진행 중입니다.');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const reqRow = await tx.channelTransferRequest.findUnique({
          where: { id: requestId },
          select: {
            id: true,
            status: true,
            channelId: true,
            targetUserId: true,
            currentOwnerUserId: true,
          },
        });
        if (!reqRow)
          throw new ResourceNotFoundException('요청을 찾을 수 없습니다.');
        if (reqRow.status !== ChannelTransferStatus.PENDING)
          throw new InvalidInputException('이미 처리된 요청입니다.');
        if (!reqRow.targetUserId || reqRow.targetUserId !== userId)
          throw new UnauthorizedException();

        await this.referralCodes.ensureForUser(reqRow.targetUserId, tx);

        // change ownership
        await tx.channel.update({
          where: { id: reqRow.channelId },
          data: { userId: reqRow.targetUserId },
        });
        await tx.channelTransferRequest.update({
          where: { id: requestId },
          data: {
            status: ChannelTransferStatus.COMPLETED,
            evidenceImages: dto.evidenceImages
              ? (dto.evidenceImages as unknown as Prisma.InputJsonValue)
              : undefined,
            consentAgreeTerms: dto.consentAgreeTerms,
            consentAgreeTransfer: dto.consentAgreeTransfer,
            consentAgreePrivacy: dto.consentAgreePrivacy,
            noteFromTarget: dto.noteFromTarget ?? null,
            targetUserId: userId,
            reviewedAt: new Date(),
          },
        });
        await tx.channelManager.deleteMany({
          where: {
            channelId: reqRow.channelId,
            userId: reqRow.currentOwnerUserId,
          },
        });
        // 채널 인증(verification) 해제 - 새 소유자가 다시 인증해야 함
        const activeVerifications = await tx.channelVerification.findMany({
          where: {
            channelId: reqRow.channelId,
            status: { not: ChannelVerificationStatus.REVOKED },
          },
        });

        if (activeVerifications.length > 0) {
          await tx.channelVerification.updateMany({
            where: {
              channelId: reqRow.channelId,
              status: { not: ChannelVerificationStatus.REVOKED },
            },
            data: { status: ChannelVerificationStatus.REVOKED },
          });

          await tx.channelVerificationLog.createMany({
            data: activeVerifications.map((v) => ({
              channelVerificationId: v.id,
              action: ChannelVerificationAction.REVOKED,
              previousStatus: v.status,
              newStatus: ChannelVerificationStatus.REVOKED,
              actorType: ChannelVerificationActorType.SYSTEM,
              reason: '채널 양도로 인한 인증 해제',
            })),
          });
        }
        await tx.channelTransferAudit.createMany({
          data: [
            {
              requestId,
              action: ChannelTransferAction.confirm,
              actorType: ChannelTransferActorType.user,
              actorUserId: userId,
            },
            {
              requestId,
              action: ChannelTransferAction.ownership_changed,
              actorType: ChannelTransferActorType.system,
            },
          ],
        });
        const talkRevoked = await this.talkV2.prepareChannelOwnershipTransfer(
          tx,
          {
            channelId: reqRow.channelId,
            previousOwnerUserId: reqRow.currentOwnerUserId,
            nextOwnerUserId: reqRow.targetUserId,
          },
        );
        return { channelId: reqRow.channelId, talkRevoked };
      });

      // DB authority is already committed. Socket/media cleanup is explicitly
      // after-commit so a provider timeout cannot roll back a completed channel
      // transfer, while the old owner is already unable to obtain new tokens.
      await this.talkV2
        .finishChannelOwnershipTransfer(result.talkRevoked)
        .catch((error) => {
          this.logger.error(
            `Talk V2 channel-transfer cleanup failed for channel ${result.channelId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });

      // notify (best-effort)
      try {
        const data = await this.prisma.channel.findUnique({
          where: { id: result.channelId },
          select: { name: true, user: { select: { email: true } } },
        });
        const reqFull = await this.prisma.channelTransferRequest.findUnique({
          where: { id: requestId },
          select: { currentOwnerUserId: true, targetUserId: true },
        });
        const users = await this.prisma.user.findMany({
          where: {
            id: {
              in: [
                reqFull?.currentOwnerUserId || 0,
                reqFull?.targetUserId || 0,
              ],
            },
          },
          select: { email: true },
        });
        const emails = users.map((u) => u.email).filter(Boolean);
        for (const to of emails) {
          await this.transactionalEmail.enqueue({
            service: 'channel',
            event: 'transfer-approve',
            to,
            subject: '[멜로밍] 채널 이전 승인 안내',
            html: getChannelTransferResultTemplate(true, data?.name || ''),
            idempotencyKey: `channel-transfer:${requestId}:approve:${emailHashHex(to)}`,
          });
        }
      } catch (e) {
        this.logger.error(
          'Failed to send approval notification emails',
          e instanceof Error ? e.stack : String(e),
        );
      }

      return { requestId, status: 'COMPLETED' };
    } finally {
      await this.distributedLockService.releaseLock(lockKey);
    }
  }
}
