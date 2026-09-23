import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { OverlayWidgetType } from '@prisma/client';
import { OverlayWidgetCustomizationController } from '../overlay-widget-customization.controller';
import { OverlayWidgetCustomizationService } from '../overlay-widget-customization.service';
import { ChannelService } from '../../channel.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ChannelPermissionGuard } from '../../guards/channel-permission.guard';

/**
 * Controller-level tests that mirror main.ts global ValidationPipe
 * (whitelist + forbidNonWhitelisted + transform) so path-param binding
 * bugs — like the 2026-04-21 regression where `@Param() dto` surfaced
 * `identifier` as a forbidden property — are caught here.
 */
describe('OverlayWidgetCustomizationController', () => {
  let app: INestApplication;
  let service: jest.Mocked<OverlayWidgetCustomizationService>;
  let channelService: jest.Mocked<ChannelService>;

  const stubEntity = {
    id: 10,
    channelId: 1,
    widgetType: OverlayWidgetType.NOW_PLAYING,
    customCss: '.a {}',
    isEnabled: true,
    createdAt: new Date('2026-04-21T00:00:00Z'),
    updatedAt: new Date('2026-04-21T00:00:00Z'),
  };

  beforeEach(async () => {
    service = {
      getAll: jest.fn().mockResolvedValue({
        items: [],
        isOwner: true,
        isOwnerPro: true,
      }),
      getOne: jest.fn().mockResolvedValue({
        customization: stubEntity,
        isOwner: true,
        isOwnerPro: true,
      }),
      upsertCss: jest.fn().mockResolvedValue(stubEntity),
      toggleEnabled: jest.fn().mockResolvedValue(stubEntity),
      deleteCss: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OverlayWidgetCustomizationService>;

    channelService = {
      findByIdentifier: jest.fn().mockResolvedValue({ id: 1 }),
    } as unknown as jest.Mocked<ChannelService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [OverlayWidgetCustomizationController],
      providers: [
        Reflector,
        { provide: OverlayWidgetCustomizationService, useValue: service },
        { provide: ChannelService, useValue: channelService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { id: 42 };
          return true;
        },
      })
      .overrideGuard(ChannelPermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('PUT /channel/:identifier/overlay-customization/css/:widget', () => {
    it('200 with valid widget + body (regression: identifier no longer rejected)', async () => {
      const res = await request(app.getHttpServer())
        .put('/channel/doyeonlive/overlay-customization/css/now-playing')
        .send({ customCss: '.x {}', isEnabled: true });

      expect(res.status).toBe(200);
      expect(channelService.findByIdentifier).toHaveBeenCalledWith('doyeonlive');
      expect(service.upsertCss).toHaveBeenCalledWith(
        1,
        42,
        'now-playing',
        { customCss: '.x {}', isEnabled: true },
      );
    });

    it('400 when widget is not in OVERLAY_WIDGET_TYPE_VALUES', async () => {
      const res = await request(app.getHttpServer())
        .put('/channel/doyeonlive/overlay-customization/css/unknown-widget')
        .send({ customCss: '.x {}' });

      expect(res.status).toBe(400);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.message[0]).toMatch(/widget must be one of/);
      expect(service.upsertCss).not.toHaveBeenCalled();
    });

    it('400 when body has a non-whitelisted property', async () => {
      const res = await request(app.getHttpServer())
        .put('/channel/doyeonlive/overlay-customization/css/now-playing')
        .send({ customCss: '.x {}', unexpected: 'field' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /channel/:identifier/overlay-customization/css/:widget', () => {
    it('200 and forwards widget to service', async () => {
      const res = await request(app.getHttpServer()).get(
        '/channel/doyeonlive/overlay-customization/css/setlist',
      );

      expect(res.status).toBe(200);
      expect(service.getOne).toHaveBeenCalledWith(1, 42, 'setlist');
    });

    it('400 on invalid widget', async () => {
      const res = await request(app.getHttpServer()).get(
        '/channel/doyeonlive/overlay-customization/css/bogus',
      );

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /channel/:identifier/overlay-customization/css/:widget/enable', () => {
    it('200 and forwards isEnabled', async () => {
      const res = await request(app.getHttpServer())
        .patch('/channel/doyeonlive/overlay-customization/css/queue/enable')
        .send({ isEnabled: false });

      expect(res.status).toBe(200);
      expect(service.toggleEnabled).toHaveBeenCalledWith(1, 42, 'queue', false);
    });
  });

  describe('DELETE /channel/:identifier/overlay-customization/css/:widget', () => {
    it('204 and forwards widget', async () => {
      const res = await request(app.getHttpServer()).delete(
        '/channel/doyeonlive/overlay-customization/css/chatbox',
      );

      expect(res.status).toBe(204);
      expect(service.deleteCss).toHaveBeenCalledWith(1, 42, 'chatbox');
    });
  });
});
