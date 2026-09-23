import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';

// 기존 KRW 후원 행에 태깅할 통화 코드 (native-first 모델 Phase A-2)
const KRW_LEGACY = 'KRW_LEGACY';
// 분산락 키 — 서비스 재배포 시 중복 실행 방지
const LOCK_KEY = 'donation-currency-backfill';
// 락 TTL: 60초 — OrganizationService와 동일. updateMany 완료 전 만료 시 재진입 허용
const LOCK_TTL_MS = 60_000;

@Injectable()
export class DonationCurrencyBackfillService {
  private readonly logger = new Logger(DonationCurrencyBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
  ) {}

  async runBackfill() {
    // 다른 pod가 락을 보유 중이면 조용히 건너뜀
    const acquired = await this.lockService.acquireLock(LOCK_KEY, LOCK_TTL_MS);
    if (!acquired) {
      this.logger.log(
        `[${LOCK_KEY}] 락 획득 실패 — 다른 pod에서 실행 중, 건너뜀`,
      );
      return;
    }

    try {
      // idempotent guard: donationAmount가 존재하고 donationCurrency가 아직 없는 행만 업데이트
      const result = await this.prisma.songRequest.updateMany({
        where: {
          donationAmount: { not: null },
          donationCurrency: null,
        },
        data: { donationCurrency: KRW_LEGACY },
      });

      if (result.count > 0) {
        this.logger.log(
          `[${LOCK_KEY}] KRW_LEGACY 태깅 완료 — ${result.count}개 행 업데이트`,
        );
      }
      // count === 0 이면 이미 완료된 상태 — prod 로그 스팸 방지를 위해 출력 생략
    } catch (error) {
      // 백필 실패가 모듈 부팅을 막으면 안 됨
      this.logger.warn(
        `[${LOCK_KEY}] 백필 중 에러 발생 — 서버 기동 계속 진행`,
        error,
      );
    } finally {
      await this.lockService.releaseLock(LOCK_KEY);
    }
  }
}
