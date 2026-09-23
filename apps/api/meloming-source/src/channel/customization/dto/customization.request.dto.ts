import {
  IsString,
  IsOptional,
  IsBoolean,
  MaxLength,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHANNEL_COLOR_MODE_VALUES,
  type ChannelColorModeValue,
} from '../constants/color-mode';
import {
  CHANNEL_LAYOUT_WIDTH_VALUES,
  type ChannelLayoutWidthValue,
} from '../constants/layout-width';
import {
  CHANNEL_HEADER_STYLE_VALUES,
  type ChannelHeaderStyleValue,
} from '../constants/header-style';
import {
  CHANNEL_LAYOUT_TYPE_VALUES,
  type ChannelLayoutTypeValue,
} from '../constants/layout-type';

/**
 * CSS 저장/수정 요청 DTO
 */
export class UpdateCssDto {
  @ApiProperty({
    description: '커스텀 CSS 코드',
    example: '.container { color: red; }',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100 * 1024, {
    message: 'CSS 크기는 최대 100KB까지 허용됩니다.',
  })
  customCss?: string;

  @ApiPropertyOptional({
    description: 'CSS 활성화 여부',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description: '신규 레이아웃 전용 커스텀 CSS 코드',
    example: '.channel-shell { background: #111; }',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100 * 1024, {
    message: 'CSS 크기는 최대 100KB까지 허용됩니다.',
  })
  customCssNew?: string;

  @ApiPropertyOptional({
    description: '신규 레이아웃 커스텀 CSS 활성화 여부',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabledNew?: boolean;

  @ApiPropertyOptional({
    description:
      '채널 페이지 레이아웃 타입 (legacy=기존 레이아웃, new=신규 메뉴 사이드바형)',
    enum: CHANNEL_LAYOUT_TYPE_VALUES,
    example: 'new',
  })
  @IsOptional()
  @IsIn(CHANNEL_LAYOUT_TYPE_VALUES)
  layoutType?: ChannelLayoutTypeValue;

  @ApiPropertyOptional({
    description: '채널 페이지 강제 색상 모드',
    enum: CHANNEL_COLOR_MODE_VALUES,
    example: 'light',
  })
  @IsOptional()
  @IsIn(CHANNEL_COLOR_MODE_VALUES)
  forcedColorMode?: ChannelColorModeValue;

  @ApiPropertyOptional({
    description: '채널 레이아웃 너비',
    enum: CHANNEL_LAYOUT_WIDTH_VALUES,
    example: 'default',
  })
  @IsOptional()
  @IsIn(CHANNEL_LAYOUT_WIDTH_VALUES)
  layoutWidth?: ChannelLayoutWidthValue;

  @ApiPropertyOptional({
    description: '채널 상단 보기 방식',
    enum: CHANNEL_HEADER_STYLE_VALUES,
    example: 'wide',
  })
  @IsOptional()
  @IsIn(CHANNEL_HEADER_STYLE_VALUES)
  headerStyle?: ChannelHeaderStyleValue;
}

/**
 * CSS 활성화/비활성화 요청 DTO
 */
export class ToggleCssEnabledDto {
  @ApiProperty({
    description: 'CSS 활성화 여부',
    example: true,
  })
  @IsBoolean()
  isEnabled!: boolean;
}
