import { ChannelLayoutWidth } from '@prisma/client';
import {
  CHANNEL_LAYOUT_WIDTH_VALUES,
  DEFAULT_CHANNEL_LAYOUT_WIDTH,
  toPrismaChannelLayoutWidth,
  toChannelLayoutWidthValue,
} from './layout-width';

describe('layout-width constants', () => {
  describe('CHANNEL_LAYOUT_WIDTH_VALUES', () => {
    it('should contain default and wide', () => {
      expect(CHANNEL_LAYOUT_WIDTH_VALUES).toEqual(['default', 'wide']);
    });
  });

  describe('DEFAULT_CHANNEL_LAYOUT_WIDTH', () => {
    it('should be default', () => {
      expect(DEFAULT_CHANNEL_LAYOUT_WIDTH).toBe('default');
    });
  });

  describe('toPrismaChannelLayoutWidth', () => {
    it('should convert default to Prisma enum', () => {
      expect(toPrismaChannelLayoutWidth('default')).toBe(
        ChannelLayoutWidth.DEFAULT,
      );
    });

    it('should convert wide to Prisma enum', () => {
      expect(toPrismaChannelLayoutWidth('wide')).toBe(
        ChannelLayoutWidth.WIDE,
      );
    });
  });

  describe('toChannelLayoutWidthValue', () => {
    it('should convert DEFAULT enum to string', () => {
      expect(toChannelLayoutWidthValue(ChannelLayoutWidth.DEFAULT)).toBe(
        'default',
      );
    });

    it('should convert WIDE enum to string', () => {
      expect(toChannelLayoutWidthValue(ChannelLayoutWidth.WIDE)).toBe('wide');
    });

    it('should return default for null', () => {
      expect(toChannelLayoutWidthValue(null)).toBe('default');
    });

    it('should return default for undefined', () => {
      expect(toChannelLayoutWidthValue(undefined)).toBe('default');
    });
  });
});
