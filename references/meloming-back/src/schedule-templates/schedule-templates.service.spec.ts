import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ScheduleTemplatesService } from './schedule-templates.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleTemplateRequestDto } from './dto/request/create-schedule-template.request.dto';
import { UpdateScheduleTemplateRequestDto } from './dto/request/update-schedule-template.request.dto';
import {
  ThumbnailGenerationError,
  ThumbnailService,
} from './services/thumbnail.service';

type PrismaMock = {
  channel: { findUnique: jest.Mock };
  channelManager: { findUnique: jest.Mock };
  scheduleTemplate: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
};

type ThumbnailServiceMock = {
  generateAndUpload: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  return {
    channel: { findUnique: jest.fn() },
    channelManager: { findUnique: jest.fn() },
    scheduleTemplate: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

function createThumbnailServiceMock(): ThumbnailServiceMock {
  return {
    generateAndUpload: jest.fn(),
  };
}

/**
 * setImmediate 큐가 비워질 때까지 대기. fire-and-forget thumbnail 작업이
 * setImmediate(() => void this.regenerate(...)) 로 스케줄되어 있으므로
 * 한 tick 만 기다리면 되지만, regenerate 안에 await thumbnail + await prisma
 * 가 있어 microtask queue 도 같이 비워야 한다. 보수적으로 두 번 flush.
 */
async function flushThumbnailQueue(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

function createTemplateRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-23T00:00:00.000Z');
  return {
    id: 1,
    channelId: 10,
    name: 'base template',
    isDefault: false,
    baseImageUrl: 'https://cdn.example.com/base.png',
    baseImageW: 1920,
    baseImageH: 1080,
    templateSpec: { slots: [] },
    originalPsdUrl: null,
    thumbnailUrl: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ScheduleTemplatesService', () => {
  let prisma: PrismaMock;
  let thumbnailService: ThumbnailServiceMock;
  let service: ScheduleTemplatesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    thumbnailService = createThumbnailServiceMock();
    // 기본은 thumbnail 자동 생성을 "성공" 으로 두되, 각 테스트가 필요시
    // 직접 mockResolvedValue/Rejected 로 덮어쓴다. 미설정 상태에서는
    // setImmediate 안의 await 가 undefined 를 만나 안전하게 끝난다.
    thumbnailService.generateAndUpload.mockResolvedValue(
      'https://cdn.example.com/template-thumb.webp',
    );
    service = new ScheduleTemplatesService(
      prisma as unknown as PrismaService,
      thumbnailService as unknown as ThumbnailService,
    );
  });

  const createDto: CreateScheduleTemplateRequestDto = {
    channelId: 10,
    name: 'base template',
    baseImageUrl: 'https://cdn.example.com/base.png',
    baseImageW: 1920,
    baseImageH: 1080,
    templateSpec: { slots: [] },
  };

  describe('create', () => {
    it('allows channel owner to create template', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
      prisma.scheduleTemplate.create.mockResolvedValue(createTemplateRow());

      const result = await service.create(5, createDto);

      expect(prisma.scheduleTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channelId: 10,
          name: 'base template',
          isDefault: false,
          baseImageUrl: 'https://cdn.example.com/base.png',
          baseImageW: 1920,
          baseImageH: 1080,
          originalPsdUrl: null,
          thumbnailUrl: null,
        }),
      });
      expect(result.id).toBe(1);
    });

    it('allows manager with canManageContent=true to create', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 99 });
      prisma.channelManager.findUnique.mockResolvedValue({
        isActive: true,
        canManageContent: true,
      });
      prisma.scheduleTemplate.create.mockResolvedValue(createTemplateRow());

      await expect(service.create(5, createDto)).resolves.toBeDefined();
    });

    it('forbids user with no manager record', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 99 });
      prisma.channelManager.findUnique.mockResolvedValue(null);

      await expect(service.create(5, createDto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.scheduleTemplate.create).not.toHaveBeenCalled();
    });

    it('forbids manager without canManageContent', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 99 });
      prisma.channelManager.findUnique.mockResolvedValue({
        isActive: true,
        canManageContent: false,
      });

      await expect(service.create(5, createDto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws NotFound when channel missing', async () => {
      prisma.channel.findUnique.mockResolvedValue(null);

      await expect(service.create(5, createDto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('returns non-deleted templates ordered for channel owner', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
      const rows = [
        createTemplateRow({ id: 1, isDefault: true }),
        createTemplateRow({ id: 2 }),
      ];
      prisma.scheduleTemplate.findMany.mockResolvedValue(rows);

      const result = await service.list(10, 5);

      expect(prisma.scheduleTemplate.findMany).toHaveBeenCalledWith({
        where: { channelId: 10, isDeleted: false },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
      expect(result).toHaveLength(2);
    });

    it('blocks unauthorized user', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 99 });
      prisma.channelManager.findUnique.mockResolvedValue(null);

      await expect(service.list(10, 5)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('getOne', () => {
    it('returns template when user is owner', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue(
        createTemplateRow({ channelId: 10 }),
      );
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });

      const result = await service.getOne(1, 5);
      expect(result.id).toBe(1);
    });

    it('throws NotFound when template missing', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue(null);

      await expect(service.getOne(1, 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFound when template soft-deleted', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue(
        createTemplateRow({ isDeleted: true, deletedAt: new Date() }),
      );

      await expect(service.getOne(1, 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates only provided fields after permission check', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue({
        id: 1,
        channelId: 10,
        baseImageUrl: 'https://cdn.example.com/old.png',
        isDeleted: false,
      });
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
      prisma.scheduleTemplate.update.mockResolvedValue(
        createTemplateRow({ name: 'renamed' }),
      );

      await service.update(1, 5, { name: 'renamed' });

      expect(prisma.scheduleTemplate.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { name: 'renamed' },
      });
    });

    it('throws NotFound for missing template', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue(null);

      await expect(service.update(1, 5, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFound for deleted template', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue({
        id: 1,
        channelId: 10,
        baseImageUrl: 'https://cdn.example.com/old.png',
        isDeleted: true,
      });

      await expect(service.update(1, 5, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('passes null through for nullable fields (originalPsdUrl, thumbnailUrl) to clear DB', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue({
        id: 1,
        channelId: 10,
        baseImageUrl: 'https://cdn.example.com/old.png',
        isDeleted: false,
      });
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
      prisma.scheduleTemplate.update.mockResolvedValue(
        createTemplateRow({ originalPsdUrl: null, thumbnailUrl: null }),
      );

      await service.update(1, 5, {
        originalPsdUrl: null,
        thumbnailUrl: null,
      });

      expect(prisma.scheduleTemplate.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { originalPsdUrl: null, thumbnailUrl: null },
      });
    });

    it('omits nullable fields from update data when undefined (no change)', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue({
        id: 1,
        channelId: 10,
        baseImageUrl: 'https://cdn.example.com/old.png',
        isDeleted: false,
      });
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
      prisma.scheduleTemplate.update.mockResolvedValue(createTemplateRow());

      await service.update(1, 5, { name: 'renamed' });

      const call = prisma.scheduleTemplate.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(call.data).toEqual({ name: 'renamed' });
      expect(call.data).not.toHaveProperty('originalPsdUrl');
      expect(call.data).not.toHaveProperty('thumbnailUrl');
    });

    it.each([
      ['name', { name: null }],
      ['isDefault', { isDefault: null }],
      ['baseImageUrl', { baseImageUrl: null }],
      ['baseImageW', { baseImageW: null }],
      ['baseImageH', { baseImageH: null }],
      ['templateSpec', { templateSpec: null }],
    ])(
      'rejects null for non-null column %s with BadRequest',
      async (_field, patch) => {
        prisma.scheduleTemplate.findUnique.mockResolvedValue({
          id: 1,
          channelId: 10,
          baseImageUrl: 'https://cdn.example.com/old.png',
          isDeleted: false,
        });
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });

        await expect(
          service.update(
            1,
            5,
            patch as unknown as UpdateScheduleTemplateRequestDto,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.scheduleTemplate.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('UpdateScheduleTemplateRequestDto validation', () => {
    async function validateDto(
      payload: Record<string, unknown>,
    ): Promise<string[]> {
      const dto = plainToInstance(
        UpdateScheduleTemplateRequestDto,
        payload,
      );
      const errors = await validate(dto);
      return errors.map((e) => e.property);
    }

    it('accepts empty body (no change)', async () => {
      expect(await validateDto({})).toEqual([]);
    });

    it('accepts valid partial fields', async () => {
      expect(
        await validateDto({
          name: 'new name',
          isDefault: true,
          baseImageUrl: 'https://cdn.example.com/a.png',
          baseImageW: 1920,
          baseImageH: 1080,
          templateSpec: { slots: [] },
        }),
      ).toEqual([]);
    });

    it('accepts null for nullable fields (originalPsdUrl, thumbnailUrl)', async () => {
      expect(
        await validateDto({ originalPsdUrl: null, thumbnailUrl: null }),
      ).toEqual([]);
    });

    it('rejects null for non-null field name', async () => {
      expect(await validateDto({ name: null })).toContain('name');
    });

    it('rejects null for non-null field isDefault', async () => {
      expect(await validateDto({ isDefault: null })).toContain('isDefault');
    });

    it('rejects null for non-null field baseImageUrl', async () => {
      expect(await validateDto({ baseImageUrl: null })).toContain(
        'baseImageUrl',
      );
    });

    it('rejects null for non-null field baseImageW', async () => {
      expect(await validateDto({ baseImageW: null })).toContain('baseImageW');
    });

    it('rejects null for non-null field baseImageH', async () => {
      expect(await validateDto({ baseImageH: null })).toContain('baseImageH');
    });

    it('rejects null for non-null field templateSpec', async () => {
      expect(await validateDto({ templateSpec: null })).toContain(
        'templateSpec',
      );
    });

    it('rejects empty string name', async () => {
      expect(await validateDto({ name: '' })).toContain('name');
    });
  });

  describe('CreateScheduleTemplateRequestDto null handling (Codex F10 review#3)', () => {
    // Codex 가 지적한 케이스: TS 타입은 string 인데 런타임에 null 이 들어올 수
    // 있어 service 의 `dto.thumbnailUrl ?? null` 분기와 어긋났다.
    // 새 DTO 타입은 `string | null | undefined` 로 정정하고, validator 도
    // null 을 명시적으로 허용해야 한다 (DB 컬럼 자체가 nullable 이므로).
    async function validateCreateDto(
      payload: Record<string, unknown>,
    ): Promise<string[]> {
      const dto = plainToInstance(CreateScheduleTemplateRequestDto, {
        // 필수 필드 채우고 시작.
        channelId: 10,
        name: 'tpl',
        baseImageUrl: 'https://cdn.example.com/base.png',
        baseImageW: 1920,
        baseImageH: 1080,
        templateSpec: { slots: [] },
        ...payload,
      });
      const errors = await validate(dto);
      return errors.map((e) => e.property);
    }

    it('accepts thumbnailUrl=null (DB clear / explicit no-thumbnail)', async () => {
      expect(await validateCreateDto({ thumbnailUrl: null })).toEqual([]);
    });

    it('accepts originalPsdUrl=null', async () => {
      expect(await validateCreateDto({ originalPsdUrl: null })).toEqual([]);
    });

    it('still rejects malformed thumbnailUrl (non-null, non-URL string)', async () => {
      // 공백 포함 문자열은 isURL 이 명백히 거부하는 케이스. ('not-a-url' 같은
      // 단일 토큰은 require_tld:false 옵션에서 호스트로 해석되어 통과한다.)
      expect(
        await validateCreateDto({ thumbnailUrl: 'has spaces in it' }),
      ).toContain('thumbnailUrl');
    });

    it('accepts thumbnailUrl=undefined (omitted) → backend auto-generates', async () => {
      expect(await validateCreateDto({})).toEqual([]);
    });
  });

  describe('automatic thumbnail generation (F10)', () => {
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      // Nest Logger 의 모든 인스턴스가 공유하는 prototype 메서드를 spy.
      // 의도적인 warn/error 출력은 테스트 스코프에서 무시 — 카운트만 검증.
      warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    describe('on create', () => {
      it('schedules thumbnail regen and stores resulting URL via conditional updateMany', async () => {
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.create.mockResolvedValue(
          createTemplateRow({ id: 7, thumbnailUrl: null }),
        );
        prisma.scheduleTemplate.updateMany.mockResolvedValue({ count: 1 });
        thumbnailService.generateAndUpload.mockResolvedValue(
          'https://cdn.example.com/template-thumb.webp',
        );

        const result = await service.create(5, createDto);

        // 응답 자체는 동기로 끝나야 함 — thumbnailUrl 은 아직 null.
        expect(result.thumbnailUrl).toBeNull();
        expect(thumbnailService.generateAndUpload).not.toHaveBeenCalled();

        await flushThumbnailQueue();

        expect(thumbnailService.generateAndUpload).toHaveBeenCalledWith(
          createDto.baseImageUrl,
          createDto.channelId,
        );
        // race-safe: WHERE 에 captured baseImageUrl 이 포함되어야 함.
        expect(prisma.scheduleTemplate.updateMany).toHaveBeenCalledWith({
          where: { id: 7, baseImageUrl: createDto.baseImageUrl },
          data: {
            thumbnailUrl: 'https://cdn.example.com/template-thumb.webp',
          },
        });
        // 사용자 PATCH 가 아닌 자동 thumbnail 반영은 update 로 직접 호출하지 않는다.
        expect(prisma.scheduleTemplate.update).not.toHaveBeenCalled();
      });

      it('skips auto regen when caller provides explicit thumbnailUrl (string)', async () => {
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.create.mockResolvedValue(
          createTemplateRow({
            id: 7,
            thumbnailUrl: 'https://cdn.example.com/manual-thumb.png',
          }),
        );

        await service.create(5, {
          ...createDto,
          thumbnailUrl: 'https://cdn.example.com/manual-thumb.png',
        });
        await flushThumbnailQueue();

        expect(thumbnailService.generateAndUpload).not.toHaveBeenCalled();
        // create 외에 자동 update 도 일어나면 안 됨
        expect(prisma.scheduleTemplate.update).not.toHaveBeenCalled();
        expect(prisma.scheduleTemplate.updateMany).not.toHaveBeenCalled();
      });

      it('skips auto regen when caller explicitly passes thumbnailUrl=null (user wants no thumbnail)', async () => {
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.create.mockResolvedValue(
          createTemplateRow({ id: 7, thumbnailUrl: null }),
        );

        // 명시적 null — "필드를 보내지 않은 것" 과 다르게 사용자가 의도적으로
        // 비워둔 케이스. 자동 재생성하지 않는다.
        await service.create(5, {
          ...createDto,
          thumbnailUrl: null,
        });
        await flushThumbnailQueue();

        expect(thumbnailService.generateAndUpload).not.toHaveBeenCalled();
        expect(prisma.scheduleTemplate.updateMany).not.toHaveBeenCalled();
      });

      it('keeps template intact when thumbnail fetch fails (warn, no DB update)', async () => {
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.create.mockResolvedValue(
          createTemplateRow({ id: 7, thumbnailUrl: null }),
        );
        thumbnailService.generateAndUpload.mockRejectedValue(
          new ThumbnailGenerationError('fetch failed', 'fetch', 'NETWORK'),
        );

        const result = await service.create(5, createDto);
        await flushThumbnailQueue();

        expect(result.id).toBe(7);
        expect(result.thumbnailUrl).toBeNull();
        // thumbnail 자동 업데이트가 발생하지 않아야 함
        expect(prisma.scheduleTemplate.update).not.toHaveBeenCalled();
        expect(prisma.scheduleTemplate.updateMany).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
      });

      it('keeps template intact when sharp processing fails (warn, no DB update)', async () => {
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.create.mockResolvedValue(
          createTemplateRow({ id: 7, thumbnailUrl: null }),
        );
        thumbnailService.generateAndUpload.mockRejectedValue(
          new ThumbnailGenerationError('sharp boom', 'process', 'SHARP_ERROR'),
        );

        await service.create(5, createDto);
        await flushThumbnailQueue();

        expect(prisma.scheduleTemplate.update).not.toHaveBeenCalled();
        expect(prisma.scheduleTemplate.updateMany).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
      });

      it('logs error (not warn) on unexpected non-typed errors', async () => {
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.create.mockResolvedValue(
          createTemplateRow({ id: 7, thumbnailUrl: null }),
        );
        thumbnailService.generateAndUpload.mockRejectedValue(
          new Error('truly unexpected'),
        );

        await service.create(5, createDto);
        await flushThumbnailQueue();

        expect(prisma.scheduleTemplate.update).not.toHaveBeenCalled();
        expect(prisma.scheduleTemplate.updateMany).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
      });

      it('skips DB update when thumbnail job is superseded (race: baseImageUrl changed mid-flight)', async () => {
        // 시나리오: A 가 baseImage=old.png 로 시작 → 도중에 B 가 same template 의
        // baseImageUrl 을 new.png 로 바꿈 → A 가 뒤늦게 thumbnailUrl 을 적용하려
        // 하지만 conditional updateMany 의 WHERE 가 더 이상 매치하지 않아 count=0.
        // 결과: A 의 thumbnail 은 폐기, B 의 thumbnail 만 살아남는다.
        const logSpy = jest
          .spyOn(Logger.prototype, 'log')
          .mockImplementation(() => undefined);
        try {
          prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
          prisma.scheduleTemplate.create.mockResolvedValue(
            createTemplateRow({
              id: 7,
              baseImageUrl: 'https://cdn.example.com/old.png',
            }),
          );
          // baseImage 가 이미 다른 값으로 바뀌어 있어 WHERE 에 매치되는 행이 없음.
          prisma.scheduleTemplate.updateMany.mockResolvedValue({ count: 0 });
          thumbnailService.generateAndUpload.mockResolvedValue(
            'https://cdn.example.com/old-thumb.webp',
          );

          await service.create(5, {
            ...createDto,
            baseImageUrl: 'https://cdn.example.com/old.png',
          });
          await flushThumbnailQueue();

          expect(prisma.scheduleTemplate.updateMany).toHaveBeenCalledWith({
            where: {
              id: 7,
              baseImageUrl: 'https://cdn.example.com/old.png',
            },
            data: {
              thumbnailUrl: 'https://cdn.example.com/old-thumb.webp',
            },
          });
          // superseded 로그 한 번 — error/warn 에는 찍히지 않아야 한다 (정상 케이스).
          expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('superseded'),
          );
        } finally {
          logSpy.mockRestore();
        }
      });
    });

    describe('on update', () => {
      const existingRow = {
        id: 1,
        channelId: 10,
        baseImageUrl: 'https://cdn.example.com/original.png',
        isDeleted: false,
      };

      it('regenerates thumbnail when baseImageUrl changes (race-safe via updateMany)', async () => {
        prisma.scheduleTemplate.findUnique.mockResolvedValue(existingRow);
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.update.mockResolvedValue(
          createTemplateRow({
            id: 1,
            baseImageUrl: 'https://cdn.example.com/new.png',
          }),
        );
        prisma.scheduleTemplate.updateMany.mockResolvedValue({ count: 1 });
        thumbnailService.generateAndUpload.mockResolvedValue(
          'https://cdn.example.com/new-thumb.webp',
        );

        await service.update(1, 5, {
          baseImageUrl: 'https://cdn.example.com/new.png',
        });
        await flushThumbnailQueue();

        expect(thumbnailService.generateAndUpload).toHaveBeenCalledWith(
          'https://cdn.example.com/new.png',
          10,
        );
        // 사용자 PATCH 는 update 1회, thumbnail 반영은 updateMany 로 분리.
        expect(prisma.scheduleTemplate.update).toHaveBeenCalledTimes(1);
        expect(prisma.scheduleTemplate.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.scheduleTemplate.updateMany).toHaveBeenCalledWith({
          where: {
            id: 1,
            baseImageUrl: 'https://cdn.example.com/new.png',
          },
          data: {
            thumbnailUrl: 'https://cdn.example.com/new-thumb.webp',
          },
        });
      });

      it('does NOT regenerate when baseImageUrl is unchanged in patch', async () => {
        prisma.scheduleTemplate.findUnique.mockResolvedValue(existingRow);
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.update.mockResolvedValue(createTemplateRow());

        // baseImageUrl 을 같은 값으로 보내도(no-op) 자동 재생성하지 않는다.
        await service.update(1, 5, {
          baseImageUrl: existingRow.baseImageUrl,
          name: 'rename',
        });
        await flushThumbnailQueue();

        expect(thumbnailService.generateAndUpload).not.toHaveBeenCalled();
        expect(prisma.scheduleTemplate.updateMany).not.toHaveBeenCalled();
      });

      it('does NOT regenerate when baseImageUrl is omitted from patch', async () => {
        prisma.scheduleTemplate.findUnique.mockResolvedValue(existingRow);
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.update.mockResolvedValue(createTemplateRow());

        await service.update(1, 5, { name: 'rename only' });
        await flushThumbnailQueue();

        expect(thumbnailService.generateAndUpload).not.toHaveBeenCalled();
        expect(prisma.scheduleTemplate.updateMany).not.toHaveBeenCalled();
      });

      it('respects explicit thumbnailUrl in same patch (skip auto regen)', async () => {
        prisma.scheduleTemplate.findUnique.mockResolvedValue(existingRow);
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.update.mockResolvedValue(createTemplateRow());

        await service.update(1, 5, {
          baseImageUrl: 'https://cdn.example.com/new.png',
          thumbnailUrl: 'https://cdn.example.com/explicit-thumb.png',
        });
        await flushThumbnailQueue();

        expect(thumbnailService.generateAndUpload).not.toHaveBeenCalled();
        expect(prisma.scheduleTemplate.updateMany).not.toHaveBeenCalled();
      });

      it('respects explicit thumbnailUrl=null in same patch (user wants no thumbnail)', async () => {
        prisma.scheduleTemplate.findUnique.mockResolvedValue(existingRow);
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.update.mockResolvedValue(createTemplateRow());

        await service.update(1, 5, {
          baseImageUrl: 'https://cdn.example.com/new.png',
          thumbnailUrl: null,
        });
        await flushThumbnailQueue();

        expect(thumbnailService.generateAndUpload).not.toHaveBeenCalled();
        expect(prisma.scheduleTemplate.updateMany).not.toHaveBeenCalled();
      });

      it('keeps user PATCH result intact when thumbnail regen fails', async () => {
        prisma.scheduleTemplate.findUnique.mockResolvedValue(existingRow);
        prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
        prisma.scheduleTemplate.update.mockResolvedValue(
          createTemplateRow({
            id: 1,
            baseImageUrl: 'https://cdn.example.com/new.png',
          }),
        );
        thumbnailService.generateAndUpload.mockRejectedValue(
          new ThumbnailGenerationError('upload failed', 'upload', 'UPLOAD_ERROR'),
        );

        const result = await service.update(1, 5, {
          baseImageUrl: 'https://cdn.example.com/new.png',
        });
        await flushThumbnailQueue();

        // 사용자 PATCH 자체는 1회 호출 — 재생성 fail 시 자동 updateMany 도 없음.
        expect(prisma.scheduleTemplate.update).toHaveBeenCalledTimes(1);
        expect(prisma.scheduleTemplate.updateMany).not.toHaveBeenCalled();
        expect(result.id).toBe(1);
        expect(warnSpy).toHaveBeenCalled();
      });

      it('skips overwrite when update-flow thumbnail job is superseded (count=0)', async () => {
        // 시나리오: 사용자가 baseImage A → B 로 PATCH (job A1 spawn) →
        // 곧이어 다시 B → C 로 PATCH (job A2 spawn) → A1 이 뒤늦게 끝나고
        // updateMany.where.baseImageUrl = B 이지만 row 의 현재 baseImage 는 C.
        // count=0 → DB 변경 없이 superseded 로그만.
        const logSpy = jest
          .spyOn(Logger.prototype, 'log')
          .mockImplementation(() => undefined);
        try {
          prisma.scheduleTemplate.findUnique.mockResolvedValue(existingRow);
          prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
          prisma.scheduleTemplate.update.mockResolvedValue(
            createTemplateRow({
              id: 1,
              baseImageUrl: 'https://cdn.example.com/B.png',
            }),
          );
          // race: WHERE 에 매치 안 됨 → count 0
          prisma.scheduleTemplate.updateMany.mockResolvedValue({ count: 0 });
          thumbnailService.generateAndUpload.mockResolvedValue(
            'https://cdn.example.com/B-thumb.webp',
          );

          await service.update(1, 5, {
            baseImageUrl: 'https://cdn.example.com/B.png',
          });
          await flushThumbnailQueue();

          expect(prisma.scheduleTemplate.updateMany).toHaveBeenCalledWith({
            where: {
              id: 1,
              baseImageUrl: 'https://cdn.example.com/B.png',
            },
            data: { thumbnailUrl: 'https://cdn.example.com/B-thumb.webp' },
          });
          expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('superseded'),
          );
        } finally {
          logSpy.mockRestore();
        }
      });
    });
  });

  describe('remove', () => {
    it('soft-deletes with isDeleted=true and deletedAt set', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue({
        id: 1,
        channelId: 10,
        isDeleted: false,
      });
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 5 });
      prisma.scheduleTemplate.update.mockResolvedValue(
        createTemplateRow({ isDeleted: true, deletedAt: new Date() }),
      );

      await service.remove(1, 5);

      const call = prisma.scheduleTemplate.update.mock.calls[0][0] as {
        where: { id: number };
        data: { isDeleted: boolean; deletedAt: Date };
      };
      expect(call.where).toEqual({ id: 1 });
      expect(call.data.isDeleted).toBe(true);
      expect(call.data.deletedAt).toBeInstanceOf(Date);
    });

    it('throws NotFound for missing template', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue(null);

      await expect(service.remove(1, 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('blocks user without canManageContent', async () => {
      prisma.scheduleTemplate.findUnique.mockResolvedValue({
        id: 1,
        channelId: 10,
        isDeleted: false,
      });
      prisma.channel.findUnique.mockResolvedValue({ id: 10, userId: 99 });
      prisma.channelManager.findUnique.mockResolvedValue({
        isActive: true,
        canManageContent: false,
      });

      await expect(service.remove(1, 5)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.scheduleTemplate.update).not.toHaveBeenCalled();
    });
  });
});
