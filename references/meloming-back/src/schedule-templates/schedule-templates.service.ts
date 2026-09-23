import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleTemplateRequestDto } from './dto/request/create-schedule-template.request.dto';
import { UpdateScheduleTemplateRequestDto } from './dto/request/update-schedule-template.request.dto';
import {
  ThumbnailGenerationError,
  ThumbnailService,
} from './services/thumbnail.service';
import { ScheduleTemplateEntity } from './types/schedule-template-with-relations.type';

@Injectable()
export class ScheduleTemplatesService {
  private readonly logger = new Logger(ScheduleTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly thumbnailService: ThumbnailService,
  ) {}

  /**
   * 채널 오너 또는 canManageContent=true인 활성 매니저만 허용.
   * 기존 ScheduleService.ensureChannelOwnerOrManager와 동일한 권한 정책.
   */
  private async ensureChannelOwnerOrManager(
    channelId: number,
    userId: number,
  ): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, userId: true },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.userId === userId) return;
    const manager = await this.prisma.channelManager.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { isActive: true, canManageContent: true },
    });
    if (!manager?.isActive || !manager.canManageContent) {
      throw new ForbiddenException('권한이 없습니다.');
    }
  }

  async create(
    userId: number,
    dto: CreateScheduleTemplateRequestDto,
  ): Promise<ScheduleTemplateEntity> {
    await this.ensureChannelOwnerOrManager(dto.channelId, userId);
    const created = await this.prisma.scheduleTemplate.create({
      data: {
        channelId: dto.channelId,
        name: dto.name,
        isDefault: dto.isDefault ?? false,
        baseImageUrl: dto.baseImageUrl,
        baseImageW: dto.baseImageW,
        baseImageH: dto.baseImageH,
        templateSpec: dto.templateSpec as Prisma.InputJsonValue,
        originalPsdUrl: dto.originalPsdUrl ?? null,
        thumbnailUrl: dto.thumbnailUrl ?? null,
      },
    });

    // 사용자가 명시적으로 thumbnailUrl 필드를 보냈다면(null 포함) 자동 재생성
    // 하지 않는다. "필드 자체가 없을 때"만 자동 생성을 시도해
    // 사용자의 의도(예: PSD 단계에서 미리 만든 썸네일을 그대로 쓰거나, 명시적
    // null 로 비워둘 때) 를 존중한다.
    if (dto.thumbnailUrl === undefined) {
      this.scheduleThumbnailRegen(created.id, dto.baseImageUrl, dto.channelId);
    }

    return created;
  }

  async list(
    channelId: number,
    userId: number,
  ): Promise<ScheduleTemplateEntity[]> {
    await this.ensureChannelOwnerOrManager(channelId, userId);
    return this.prisma.scheduleTemplate.findMany({
      where: { channelId, isDeleted: false },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getOne(id: number, userId: number): Promise<ScheduleTemplateEntity> {
    const row = await this.prisma.scheduleTemplate.findUnique({
      where: { id },
    });
    if (!row || row.isDeleted) {
      throw new NotFoundException('ScheduleTemplate not found');
    }
    await this.ensureChannelOwnerOrManager(row.channelId, userId);
    return row;
  }

  async update(
    id: number,
    userId: number,
    dto: UpdateScheduleTemplateRequestDto,
  ): Promise<ScheduleTemplateEntity> {
    const existing = await this.prisma.scheduleTemplate.findUnique({
      where: { id },
      select: {
        id: true,
        channelId: true,
        baseImageUrl: true,
        isDeleted: true,
      },
    });
    if (!existing || existing.isDeleted) {
      throw new NotFoundException('ScheduleTemplate not found');
    }
    await this.ensureChannelOwnerOrManager(existing.channelId, userId);

    // Defense-in-depth: non-null 컬럼은 DTO 검증을 통과해도 null 이면 차단.
    // DTO 레벨에서 이미 걸러지지만, 직접 호출(internal 콜/마이그레이션 스크립트 등)에서
    // 실수로 null 이 들어오는 경우 Prisma validation error (500) 대신 BadRequest 로 명시.
    const nonNullViolations: string[] = [];
    if (dto.name === null) nonNullViolations.push('name');
    if (dto.isDefault === null) nonNullViolations.push('isDefault');
    if (dto.baseImageUrl === null) nonNullViolations.push('baseImageUrl');
    if (dto.baseImageW === null) nonNullViolations.push('baseImageW');
    if (dto.baseImageH === null) nonNullViolations.push('baseImageH');
    if (dto.templateSpec === null) nonNullViolations.push('templateSpec');
    if (nonNullViolations.length > 0) {
      throw new BadRequestException(
        `다음 필드는 null로 설정할 수 없습니다: ${nonNullViolations.join(', ')}`,
      );
    }

    const data: Prisma.ScheduleTemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.baseImageUrl !== undefined) data.baseImageUrl = dto.baseImageUrl;
    if (dto.baseImageW !== undefined) data.baseImageW = dto.baseImageW;
    if (dto.baseImageH !== undefined) data.baseImageH = dto.baseImageH;
    if (dto.templateSpec !== undefined) {
      data.templateSpec = dto.templateSpec as Prisma.InputJsonValue;
    }
    // nullable 컬럼: null 명시 → DB clear, undefined → 미변경.
    if (dto.originalPsdUrl !== undefined) {
      data.originalPsdUrl = dto.originalPsdUrl;
    }
    if (dto.thumbnailUrl !== undefined) {
      data.thumbnailUrl = dto.thumbnailUrl;
    }

    const updated = await this.prisma.scheduleTemplate.update({
      where: { id },
      data,
    });

    // baseImageUrl 이 실제로 바뀌었고, 사용자가 같은 PATCH 에서
    // thumbnailUrl 필드를 명시적으로 보내지 않았을 때만 자동 재생성한다.
    //  - thumbnailUrl 필드 명시(null 포함) → 사용자 의도 존중, 자동 재생성 X
    //  - thumbnailUrl 필드 부재 → 자동 재생성 (baseImageUrl 변경 시에만)
    //  - baseImageUrl 변경 없음 → 기존 thumbnail 그대로 유효, 재생성 X
    const baseImageChanged =
      dto.baseImageUrl !== undefined &&
      dto.baseImageUrl !== existing.baseImageUrl;
    const userOverrodeThumbnail = dto.thumbnailUrl !== undefined;
    if (baseImageChanged && !userOverrodeThumbnail) {
      // baseImageChanged 가 true 라는 건 dto.baseImageUrl 이 string 임을 의미.
      this.scheduleThumbnailRegen(id, dto.baseImageUrl, existing.channelId);
    }

    return updated;
  }

  async remove(id: number, userId: number): Promise<ScheduleTemplateEntity> {
    const existing = await this.prisma.scheduleTemplate.findUnique({
      where: { id },
      select: { id: true, channelId: true, isDeleted: true },
    });
    if (!existing || existing.isDeleted) {
      throw new NotFoundException('ScheduleTemplate not found');
    }
    await this.ensureChannelOwnerOrManager(existing.channelId, userId);
    return this.prisma.scheduleTemplate.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  /**
   * Thumbnail 자동 생성을 fire-and-forget 으로 트리거.
   *
   * 의도적으로 await 하지 않는다 — create/update 응답 latency 에
   * 외부 fetch + sharp 작업을 끼워넣지 않기 위해서다. 실패는 warn 으로
   * 남기고 무시; 템플릿 자체는 이미 저장되어 있고 thumbnailUrl 은
   * null 로 두면 프론트가 baseImageUrl 로 fallback 한다.
   *
   * setImmediate 를 쓰는 이유: NestJS 컨트롤러 응답이 완전히 끝난 뒤
   * 다음 tick 에서 시작하도록 하여, 동일 이벤트 루프 마이크로태스크 큐에
   * 무거운 작업을 쌓지 않는다. 단일 1회성 작업이라 큐(BullMQ 등) 도입은 과함.
   */
  private scheduleThumbnailRegen(
    templateId: number,
    baseImageUrl: string,
    channelId: number,
  ): void {
    setImmediate(() => {
      void this.regenerateThumbnail(templateId, baseImageUrl, channelId);
    });
  }

  /**
   * 실제 썸네일 생성 + DB 반영. 외부에서 직접 호출하지 않으나
   * 향후 admin retry endpoint 가 생기면 export 하면 된다.
   *
   * 실패는 warn 로그로 흡수하고 throw 하지 않는다 — fire-and-forget
   * 호출자(setImmediate) 가 받을 곳이 없어서 unhandled rejection 이
   * 되기 때문. 단 ThumbnailGenerationError 는 ThumbnailService 가
   * 이미 stage 별 로깅을 한 뒤 던진 것이라 여기서는 컨텍스트만 보강한다.
   *
   * 동시성 안전성 (Codex F10 review):
   *  - `baseImageUrl` 은 이 작업이 시작된 시점의 값(`capturedBaseImageUrl`).
   *  - 작업 도중 사용자가 또 다시 baseImageUrl 을 바꾸면(=새 thumbnail job
   *    이 spawn) 우리 작업의 결과는 stale 하다. `update` 대신 conditional
   *    `updateMany` 로 "여전히 같은 baseImageUrl 을 가진 row" 만 패치하고,
   *    count==0 이면 superseded — DB 를 건드리지 않고 종료.
   */
  private async regenerateThumbnail(
    templateId: number,
    capturedBaseImageUrl: string,
    channelId: number,
  ): Promise<void> {
    try {
      const thumbnailUrl = await this.thumbnailService.generateAndUpload(
        capturedBaseImageUrl,
        channelId,
      );
      const result = await this.prisma.scheduleTemplate.updateMany({
        where: { id: templateId, baseImageUrl: capturedBaseImageUrl },
        data: { thumbnailUrl },
      });
      if (result.count === 0) {
        // baseImageUrl 이 작업 도중 또 다시 바뀌었다 — 이 thumbnail 은
        // 옛날 base 의 산물이라 superseded. 새 job 이 자기 thumbnail 을
        // 따로 만들고 있을 것이므로 DB 를 덮어쓰지 않는다.
        this.logger.log(
          `Thumbnail job superseded; skipping update for template=${templateId}`,
        );
      }
    } catch (err) {
      if (err instanceof ThumbnailGenerationError) {
        this.logger.warn(
          `Skipping thumbnail update for template=${templateId} (stage=${err.stage}${
            err.reason ? `, reason=${err.reason}` : ''
          }): ${err.message}`,
        );
        return;
      }
      // 예상치 못한 에러는 더 큰 신호 — error 로 남긴다. silent fail 금지.
      this.logger.error(
        `Unexpected thumbnail regen failure for template=${templateId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
