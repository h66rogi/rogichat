import { Prisma } from '@prisma/client';

export const overlayWidgetCustomizationSelect = {
  id: true,
  channelId: true,
  widgetType: true,
  customCss: true,
  isEnabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OverlayWidgetCustomizationSelect;

export type OverlayWidgetCustomization =
  Prisma.OverlayWidgetCustomizationGetPayload<{
    select: typeof overlayWidgetCustomizationSelect;
  }>;
