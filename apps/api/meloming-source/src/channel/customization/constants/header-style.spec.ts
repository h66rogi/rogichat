import { ChannelHeaderStyle } from '@prisma/client';
import {
  CHANNEL_HEADER_STYLE_VALUES,
  DEFAULT_CHANNEL_HEADER_STYLE,
  toPrismaChannelHeaderStyle,
  toChannelHeaderStyleValue,
} from './header-style';

describe('header-style constants', () => {
  describe('CHANNEL_HEADER_STYLE_VALUES', () => {
    it('should contain wide and separated', () => {
      expect(CHANNEL_HEADER_STYLE_VALUES).toEqual(['wide', 'separated']);
    });
  });

  describe('DEFAULT_CHANNEL_HEADER_STYLE', () => {
    it('should be wide', () => {
      expect(DEFAULT_CHANNEL_HEADER_STYLE).toBe('wide');
    });
  });

  describe('toPrismaChannelHeaderStyle', () => {
    it('should convert wide to Prisma enum', () => {
      expect(toPrismaChannelHeaderStyle('wide')).toBe(
        ChannelHeaderStyle.WIDE,
      );
    });

    it('should convert separated to Prisma enum', () => {
      expect(toPrismaChannelHeaderStyle('separated')).toBe(
        ChannelHeaderStyle.SEPARATED,
      );
    });
  });

  describe('toChannelHeaderStyleValue', () => {
    it('should convert WIDE enum to string', () => {
      expect(toChannelHeaderStyleValue(ChannelHeaderStyle.WIDE)).toBe('wide');
    });

    it('should convert SEPARATED enum to string', () => {
      expect(toChannelHeaderStyleValue(ChannelHeaderStyle.SEPARATED)).toBe(
        'separated',
      );
    });

    it('should return wide for null', () => {
      expect(toChannelHeaderStyleValue(null)).toBe('wide');
    });

    it('should return wide for undefined', () => {
      expect(toChannelHeaderStyleValue(undefined)).toBe('wide');
    });
  });
});
