import { OverlayWidgetType } from '@prisma/client';
import {
  OVERLAY_WIDGET_TYPE_VALUES,
  toPrismaOverlayWidgetType,
  toOverlayWidgetTypeValue,
} from '../constants/overlay-widget-type';

describe('overlay-widget-type constants', () => {
  it('exposes the supported widget kinds', () => {
    expect(OVERLAY_WIDGET_TYPE_VALUES).toEqual([
      'queue',
      'now-playing',
      'setlist',
      'chatbox',
      'lyrics',
      'songbook-qr',
    ]);
  });

  it('maps API values to Prisma enum', () => {
    expect(toPrismaOverlayWidgetType('queue')).toBe(OverlayWidgetType.QUEUE);
    expect(toPrismaOverlayWidgetType('now-playing')).toBe(
      OverlayWidgetType.NOW_PLAYING,
    );
    expect(toPrismaOverlayWidgetType('setlist')).toBe(
      OverlayWidgetType.SETLIST,
    );
    expect(toPrismaOverlayWidgetType('chatbox')).toBe(
      OverlayWidgetType.CHATBOX,
    );
    expect(toPrismaOverlayWidgetType('lyrics')).toBe(OverlayWidgetType.LYRICS);
    expect(toPrismaOverlayWidgetType('songbook-qr')).toBe(
      OverlayWidgetType.SONGBOOK_QR,
    );
  });

  it('maps Prisma enum back to API values', () => {
    expect(toOverlayWidgetTypeValue(OverlayWidgetType.QUEUE)).toBe('queue');
    expect(toOverlayWidgetTypeValue(OverlayWidgetType.NOW_PLAYING)).toBe(
      'now-playing',
    );
    expect(toOverlayWidgetTypeValue(OverlayWidgetType.SETLIST)).toBe(
      'setlist',
    );
    expect(toOverlayWidgetTypeValue(OverlayWidgetType.CHATBOX)).toBe(
      'chatbox',
    );
    expect(toOverlayWidgetTypeValue(OverlayWidgetType.LYRICS)).toBe('lyrics');
    expect(toOverlayWidgetTypeValue(OverlayWidgetType.SONGBOOK_QR)).toBe(
      'songbook-qr',
    );
  });
});
