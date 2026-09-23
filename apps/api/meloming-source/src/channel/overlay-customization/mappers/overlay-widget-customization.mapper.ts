import {
  OverlayWidgetCssListResponseDto,
  OverlayWidgetCssResponseDto,
  OverlayWidgetCssWithAccessResponseDto,
} from '../dto/overlay-widget-css.response.dto';
import { toOverlayWidgetTypeValue } from '../constants/overlay-widget-type';
import type { OverlayWidgetCustomization } from '../prisma/overlay-widget-customization.selections';

export function toOverlayWidgetCssResponseDto(
  entity: OverlayWidgetCustomization,
): OverlayWidgetCssResponseDto {
  return {
    id: entity.id,
    channelId: entity.channelId,
    widgetType: toOverlayWidgetTypeValue(entity.widgetType),
    customCss: entity.customCss ?? null,
    isEnabled: entity.isEnabled,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toOverlayWidgetCssListResponseDto(data: {
  items: OverlayWidgetCustomization[];
  isOwner: boolean;
  isOwnerPro: boolean;
}): OverlayWidgetCssListResponseDto {
  return {
    items: data.items.map(toOverlayWidgetCssResponseDto),
    isOwner: data.isOwner,
    isOwnerPro: data.isOwnerPro,
    canSave: true,
  };
}

export function toOverlayWidgetCssWithAccessResponseDto(data: {
  customization: OverlayWidgetCustomization | null;
  isOwner: boolean;
  isOwnerPro: boolean;
}): OverlayWidgetCssWithAccessResponseDto {
  return {
    customization: data.customization
      ? toOverlayWidgetCssResponseDto(data.customization)
      : null,
    isOwner: data.isOwner,
    isOwnerPro: data.isOwnerPro,
    canSave: true,
  };
}
