import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OverlayWidgetType } from '@prisma/client';
import { OverlayWidgetCustomizationService } from '../overlay-widget-customization.service';
import { CssValidatorService } from '../../customization/css-validator.service';
import { ChannelService } from '../../channel.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

describe('OverlayWidgetCustomizationService', () => {
  let service: OverlayWidgetCustomizationService;
  let prisma: any;
  let validator: any;
  let channelService: any;
  let cache: any;
  let eventEmitter: any;

  beforeEach(async () => {
    prisma = {
      channel: { findUnique: jest.fn() },
      overlayWidgetCustomization: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
    };
    validator = { validate: jest.fn() };
    channelService = { getManagerPermissions: jest.fn() };
    cache = { del: jest.fn() };
    eventEmitter = { emit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OverlayWidgetCustomizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: CssValidatorService, useValue: validator },
        { provide: ChannelService, useValue: channelService },
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = moduleRef.get(OverlayWidgetCustomizationService);
  });

  it('upsertCss allows non-pro owner', async () => {
    prisma.channel.findUnique.mockResolvedValue({
      id: 1,
      userId: 2,
      user: { isProSubscriber: false, proSubscriptionEndAt: null },
      webPath: 'ch',
    });
    validator.validate.mockReturnValue({ isValid: true, errors: [] });
    prisma.overlayWidgetCustomization.upsert.mockResolvedValue({
      id: 9,
      channelId: 1,
      widgetType: OverlayWidgetType.QUEUE,
      customCss: '.x{}',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.upsertCss(1, 2, 'queue', {
        customCss: '.x{}',
        isEnabled: true,
      }),
    ).resolves.toMatchObject({ id: 9 });
  });

  it('upsertCss rejects invalid CSS', async () => {
    prisma.channel.findUnique.mockResolvedValue({
      id: 1,
      userId: 2,
      user: { isProSubscriber: true, proSubscriptionEndAt: null },
      webPath: 'ch',
    });
    validator.validate.mockReturnValue({
      isValid: false,
      errors: [{ message: '문법 오류' }],
    });
    await expect(
      service.upsertCss(1, 2, 'queue', { customCss: 'bad!!', isEnabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsertCss writes via prisma upsert when valid', async () => {
    prisma.channel.findUnique.mockResolvedValue({
      id: 1,
      userId: 2,
      user: { isProSubscriber: true, proSubscriptionEndAt: null },
      webPath: 'ch',
    });
    validator.validate.mockReturnValue({ isValid: true, errors: [] });
    prisma.overlayWidgetCustomization.upsert.mockResolvedValue({
      id: 9,
      channelId: 1,
      widgetType: OverlayWidgetType.QUEUE,
      customCss: '.x{}',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.upsertCss(1, 2, 'queue', {
      customCss: '.x{}',
      isEnabled: true,
    });
    expect(result.id).toBe(9);
    expect(prisma.overlayWidgetCustomization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channelId_widgetType: {
            channelId: 1,
            widgetType: OverlayWidgetType.QUEUE,
          },
        },
      }),
    );
  });

  it('emits widget-css.updated after upsert', async () => {
    prisma.channel.findUnique.mockResolvedValue({
      id: 1,
      userId: 2,
      user: { isProSubscriber: true, proSubscriptionEndAt: null },
      webPath: 'ch',
    });
    validator.validate.mockReturnValue({ isValid: true, errors: [] });
    prisma.overlayWidgetCustomization.upsert.mockResolvedValue({
      id: 1,
      channelId: 1,
      widgetType: OverlayWidgetType.QUEUE,
      customCss: '.x{}',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.upsertCss(1, 2, 'queue', { customCss: '.x{}', isEnabled: true });

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'overlay.widget-css.updated',
      {
        channelId: 1,
        widgetType: 'queue',
        customCss: '.x{}',
        isEnabled: true,
      },
    );
  });

  it('getAll returns visible list for owner (Pro not required)', async () => {
    prisma.channel.findUnique.mockResolvedValue({
      id: 1,
      userId: 2,
      user: { isProSubscriber: false, proSubscriptionEndAt: null },
    });
    prisma.overlayWidgetCustomization.findMany.mockResolvedValue([]);
    const result = await service.getAll(1, 2);
    expect(result.items).toEqual([]);
    expect(result.isOwner).toBe(true);
    expect(result.isOwnerPro).toBe(false);
  });
});
