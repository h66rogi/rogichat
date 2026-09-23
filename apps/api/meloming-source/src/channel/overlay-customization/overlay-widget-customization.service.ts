import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { CssValidatorService } from '../customization/css-validator.service';
import { ChannelService } from '../channel.service';
import { channelCacheKeys } from '../cache/channel.cache-keys';
import {
  assertCustomizationManageAccess,
} from '../customization/utils/channel-ownership.util';
import {
  overlayWidgetCustomizationSelect,
  type OverlayWidgetCustomization,
} from './prisma/overlay-widget-customization.selections';
import {
  toPrismaOverlayWidgetType,
  type OverlayWidgetTypeValue,
} from './constants/overlay-widget-type';
import type { UpdateOverlayWidgetCssDto } from './dto/overlay-widget-css.request.dto';

export const OVERLAY_WIDGET_CSS_UPDATED_EVENT = 'overlay.widget-css.updated';

export interface OverlayWidgetCssUpdatedEventPayload {
  channelId: number;
  widgetType: OverlayWidgetTypeValue;
  customCss: string | null;
  isEnabled: boolean;
}

@Injectable()
export class OverlayWidgetCustomizationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly validator: CssValidatorService,
    private readonly channelService: ChannelService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getAll(
    channelId: number,
    userId: number,
  ): Promise<{
    items: OverlayWidgetCustomization[];
    isOwner: boolean;
    isOwnerPro: boolean;
  }> {
    const { isOwner, isOwnerPro } = await assertCustomizationManageAccess(
      this.prisma,
      this.channelService,
      channelId,
      userId,
    );

    const items = await this.prisma.overlayWidgetCustomization.findMany({
      where: { channelId },
      select: overlayWidgetCustomizationSelect,
      orderBy: { widgetType: 'asc' },
    });

    return { items, isOwner, isOwnerPro };
  }

  async getOne(
    channelId: number,
    userId: number,
    widget: OverlayWidgetTypeValue,
  ): Promise<{
    customization: OverlayWidgetCustomization | null;
    isOwner: boolean;
    isOwnerPro: boolean;
  }> {
    const { isOwner, isOwnerPro } = await assertCustomizationManageAccess(
      this.prisma,
      this.channelService,
      channelId,
      userId,
    );

    const customization =
      await this.prisma.overlayWidgetCustomization.findUnique({
        where: {
          channelId_widgetType: {
            channelId,
            widgetType: toPrismaOverlayWidgetType(widget),
          },
        },
        select: overlayWidgetCustomizationSelect,
      });

    return { customization, isOwner, isOwnerPro };
  }

  async upsertCss(
    channelId: number,
    userId: number,
    widget: OverlayWidgetTypeValue,
    dto: UpdateOverlayWidgetCssDto,
  ): Promise<OverlayWidgetCustomization> {
    await assertCustomizationManageAccess(
      this.prisma,
      this.channelService,
      channelId,
      userId,
    );

    if (dto.customCss !== undefined) {
      const validation = this.validator.validate(dto.customCss ?? '');
      if (!validation.isValid) {
        throw new BadRequestException({
          message: 'CSS 검증 실패',
          errors: validation.errors,
        });
      }
    }

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, webPath: true },
    });
    if (!channel) throw new NotFoundException('채널을 찾을 수 없습니다.');

    const widgetType = toPrismaOverlayWidgetType(widget);
    const updateData: {
      customCss?: string | null;
      isEnabled?: boolean;
    } = {};
    if (dto.customCss !== undefined)
      updateData.customCss = dto.customCss || null;
    if (dto.isEnabled !== undefined) updateData.isEnabled = dto.isEnabled;

    const customization = await this.prisma.overlayWidgetCustomization.upsert({
      where: { channelId_widgetType: { channelId, widgetType } },
      create: {
        channelId,
        widgetType,
        customCss: dto.customCss ?? null,
        isEnabled: dto.isEnabled ?? false,
      },
      update: updateData,
      select: overlayWidgetCustomizationSelect,
    });

    await this.invalidateChannelCache(channelId, channel.webPath);
    this.eventEmitter.emit(OVERLAY_WIDGET_CSS_UPDATED_EVENT, {
      channelId,
      widgetType: widget,
      customCss: customization.customCss,
      isEnabled: customization.isEnabled,
    } satisfies OverlayWidgetCssUpdatedEventPayload);
    return customization;
  }

  async toggleEnabled(
    channelId: number,
    userId: number,
    widget: OverlayWidgetTypeValue,
    isEnabled: boolean,
  ): Promise<OverlayWidgetCustomization> {
    await assertCustomizationManageAccess(
      this.prisma,
      this.channelService,
      channelId,
      userId,
    );
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, webPath: true },
    });
    if (!channel) throw new NotFoundException('채널을 찾을 수 없습니다.');

    const widgetType = toPrismaOverlayWidgetType(widget);
    const customization = await this.prisma.overlayWidgetCustomization.upsert({
      where: { channelId_widgetType: { channelId, widgetType } },
      create: { channelId, widgetType, customCss: null, isEnabled },
      update: { isEnabled },
      select: overlayWidgetCustomizationSelect,
    });
    await this.invalidateChannelCache(channelId, channel.webPath);
    this.eventEmitter.emit(OVERLAY_WIDGET_CSS_UPDATED_EVENT, {
      channelId,
      widgetType: widget,
      customCss: customization.customCss,
      isEnabled: customization.isEnabled,
    } satisfies OverlayWidgetCssUpdatedEventPayload);
    return customization;
  }

  async deleteCss(
    channelId: number,
    userId: number,
    widget: OverlayWidgetTypeValue,
  ): Promise<void> {
    await assertCustomizationManageAccess(
      this.prisma,
      this.channelService,
      channelId,
      userId,
    );
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, webPath: true },
    });
    if (!channel) throw new NotFoundException('채널을 찾을 수 없습니다.');

    const widgetType = toPrismaOverlayWidgetType(widget);
    await this.prisma.overlayWidgetCustomization
      .delete({
        where: { channelId_widgetType: { channelId, widgetType } },
      })
      .catch((err) => {
        if ((err as { code?: string }).code === 'P2025') return;
        throw err;
      });

    this.eventEmitter.emit(OVERLAY_WIDGET_CSS_UPDATED_EVENT, {
      channelId,
      widgetType: widget,
      customCss: null,
      isEnabled: false,
    } satisfies OverlayWidgetCssUpdatedEventPayload);
    await this.invalidateChannelCache(channelId, channel.webPath);
  }

  private async invalidateChannelCache(
    channelId: number,
    webPath: string,
  ): Promise<void> {
    await Promise.all([
      this.cache.del(channelCacheKeys.byId(channelId)),
      this.cache.del(channelCacheKeys.byWebPath(webPath)),
    ]);
  }
}
