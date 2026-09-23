import { OverlayWidgetType } from '@prisma/client';

export const OVERLAY_WIDGET_TYPE_VALUES = [
  'queue',
  'now-playing',
  'setlist',
  'chatbox',
  'lyrics',
  'songbook-qr',
] as const;

export type OverlayWidgetTypeValue =
  (typeof OVERLAY_WIDGET_TYPE_VALUES)[number];

const TO_PRISMA: Record<OverlayWidgetTypeValue, OverlayWidgetType> = {
  queue: OverlayWidgetType.QUEUE,
  'now-playing': OverlayWidgetType.NOW_PLAYING,
  setlist: OverlayWidgetType.SETLIST,
  chatbox: OverlayWidgetType.CHATBOX,
  lyrics: OverlayWidgetType.LYRICS,
  'songbook-qr': OverlayWidgetType.SONGBOOK_QR,
};

const FROM_PRISMA: Record<OverlayWidgetType, OverlayWidgetTypeValue> = {
  [OverlayWidgetType.QUEUE]: 'queue',
  [OverlayWidgetType.NOW_PLAYING]: 'now-playing',
  [OverlayWidgetType.SETLIST]: 'setlist',
  [OverlayWidgetType.CHATBOX]: 'chatbox',
  [OverlayWidgetType.LYRICS]: 'lyrics',
  [OverlayWidgetType.SONGBOOK_QR]: 'songbook-qr',
};

export const toPrismaOverlayWidgetType = (
  value: OverlayWidgetTypeValue,
): OverlayWidgetType => TO_PRISMA[value];

export const toOverlayWidgetTypeValue = (
  value: OverlayWidgetType,
): OverlayWidgetTypeValue => FROM_PRISMA[value];
