import { OverlayWidgetType } from '@prisma/client';
import {
  toOverlayWidgetCssResponseDto,
  toOverlayWidgetCssListResponseDto,
  toOverlayWidgetCssWithAccessResponseDto,
} from '../mappers/overlay-widget-customization.mapper';

describe('overlay-widget-customization mapper', () => {
  const sample = {
    id: 1,
    channelId: 10,
    widgetType: OverlayWidgetType.QUEUE,
    customCss: '.x { color: red; }',
    isEnabled: true,
    createdAt: new Date('2026-04-15T00:00:00Z'),
    updatedAt: new Date('2026-04-15T00:00:00Z'),
  };

  it('maps single entity to response DTO with string widgetType', () => {
    const dto = toOverlayWidgetCssResponseDto(sample);
    expect(dto.widgetType).toBe('queue');
    expect(dto.customCss).toBe('.x { color: red; }');
  });

  it('builds list response with canSave for authorized users', () => {
    const list = toOverlayWidgetCssListResponseDto({
      items: [sample],
      isOwner: true,
      isOwnerPro: false,
    });
    expect(list.items).toHaveLength(1);
    expect(list.canSave).toBe(true);
  });

  it('handles null customization in with-access mapper', () => {
    const dto = toOverlayWidgetCssWithAccessResponseDto({
      customization: null,
      isOwner: true,
      isOwnerPro: false,
    });
    expect(dto.customization).toBeNull();
    expect(dto.canSave).toBe(true);
  });
});
