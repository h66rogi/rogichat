import { ChannelColorMode, ChannelLayoutWidth, ChannelHeaderStyle } from '@prisma/client';
import {
  toChannelCustomizationResponseDto,
  toChannelCustomizationWithAccessResponseDto,
} from './customization.mapper';
import type { ChannelCustomization } from '../prisma/customization.selections';

const baseCustomization: ChannelCustomization = {
  id: 1,
  channelId: 100,
  customCss: '.test { color: red; }',
  isEnabled: true,
  forcedColorMode: ChannelColorMode.DARK,
  layoutWidth: ChannelLayoutWidth.WIDE,
  headerStyle: ChannelHeaderStyle.SEPARATED,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-02'),
};

describe('toChannelCustomizationResponseDto', () => {
  it('should map all fields correctly', () => {
    const result = toChannelCustomizationResponseDto(baseCustomization);

    expect(result.id).toBe(1);
    expect(result.channelId).toBe(100);
    expect(result.customCss).toBe('.test { color: red; }');
    expect(result.isEnabled).toBe(true);
    expect(result.forcedColorMode).toBe('dark');
    expect(result.layoutWidth).toBe('wide');
    expect(result.headerStyle).toBe('separated');
    expect(result.createdAt).toEqual(new Date('2025-01-01'));
    expect(result.updatedAt).toEqual(new Date('2025-01-02'));
  });

  it('should convert null customCss to null', () => {
    const result = toChannelCustomizationResponseDto({
      ...baseCustomization,
      customCss: null,
    });

    expect(result.customCss).toBeNull();
  });

  it('should map DEFAULT layoutWidth and WIDE headerStyle', () => {
    const result = toChannelCustomizationResponseDto({
      ...baseCustomization,
      layoutWidth: ChannelLayoutWidth.DEFAULT,
      headerStyle: ChannelHeaderStyle.WIDE,
    });

    expect(result.layoutWidth).toBe('default');
    expect(result.headerStyle).toBe('wide');
  });

  it('should map LIGHT and SYSTEM color modes', () => {
    expect(
      toChannelCustomizationResponseDto({
        ...baseCustomization,
        forcedColorMode: ChannelColorMode.LIGHT,
      }).forcedColorMode,
    ).toBe('light');

    expect(
      toChannelCustomizationResponseDto({
        ...baseCustomization,
        forcedColorMode: ChannelColorMode.SYSTEM,
      }).forcedColorMode,
    ).toBe('system');
  });
});

describe('toChannelCustomizationWithAccessResponseDto', () => {
  it('should map customization with access info', () => {
    const result = toChannelCustomizationWithAccessResponseDto({
      customization: baseCustomization,
      isOwner: true,
      isOwnerPro: true,
    });

    expect(result.customization).toBeDefined();
    expect(result.customization!.id).toBe(1);
    expect(result.customization!.layoutWidth).toBe('wide');
    expect(result.customization!.headerStyle).toBe('separated');
    expect(result.isOwner).toBe(true);
    expect(result.isOwnerPro).toBe(true);
    expect(result.canSave).toBe(true);
  });

  it('should return null customization when input is null', () => {
    const result = toChannelCustomizationWithAccessResponseDto({
      customization: null,
      isOwner: true,
      isOwnerPro: false,
    });

    expect(result.customization).toBeNull();
    expect(result.isOwner).toBe(true);
    expect(result.isOwnerPro).toBe(false);
    expect(result.canSave).toBe(false);
  });

  it('should set canSave to false when not owner pro', () => {
    const result = toChannelCustomizationWithAccessResponseDto({
      customization: baseCustomization,
      isOwner: false,
      isOwnerPro: false,
    });

    expect(result.canSave).toBe(false);
  });
});
