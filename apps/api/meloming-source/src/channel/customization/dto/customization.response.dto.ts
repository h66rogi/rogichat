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
 * CSS 검증 오류 상세 DTO
 */
export class CssValidationErrorDto {
  @ApiProperty({
    description: '오류 메시지',
    example: 'CSS 문법 오류가 있습니다.',
  })
  message!: string;

  @ApiPropertyOptional({
    description: '오류 발생 라인 번호',
    example: 5,
  })
  line?: number;

  @ApiPropertyOptional({
    description: '오류 발생 컬럼 번호',
    example: 12,
  })
  column?: number;
}

/**
 * 채널 커스터마이징 응답 DTO
 */
export class ChannelCustomizationResponseDto {
  @ApiProperty({
    description: '채널 커스터마이징 ID',
    example: 1,
  })
  id!: number;

  @ApiProperty({
    description: '채널 ID',
    example: 123,
  })
  channelId!: number;

  @ApiPropertyOptional({
    description: '커스텀 CSS 코드',
    example: '.container { color: red; }',
    nullable: true,
  })
  customCss?: string | null;

  @ApiProperty({
    description: 'CSS 활성화 여부',
    example: true,
  })
  isEnabled!: boolean;

  @ApiPropertyOptional({
    description: '신규 레이아웃 전용 커스텀 CSS 코드',
    example: '.channel-shell { background: #111; }',
    nullable: true,
  })
  customCssNew?: string | null;

  @ApiProperty({
    description: '신규 레이아웃 커스텀 CSS 활성화 여부',
    example: false,
  })
  isEnabledNew!: boolean;

  @ApiProperty({
    description:
      '채널 페이지 레이아웃 타입 (legacy=기존 레이아웃, new=신규 메뉴 사이드바형)',
    enum: CHANNEL_LAYOUT_TYPE_VALUES,
    example: 'new',
  })
  layoutType!: ChannelLayoutTypeValue;

  @ApiProperty({
    description: '채널 페이지 강제 색상 모드',
    enum: CHANNEL_COLOR_MODE_VALUES,
    example: 'light',
  })
  forcedColorMode!: ChannelColorModeValue;

  @ApiProperty({
    description: '채널 레이아웃 너비',
    enum: CHANNEL_LAYOUT_WIDTH_VALUES,
    example: 'default',
  })
  layoutWidth!: ChannelLayoutWidthValue;

  @ApiProperty({
    description: '채널 상단 보기 방식',
    enum: CHANNEL_HEADER_STYLE_VALUES,
    example: 'wide',
  })
  headerStyle!: ChannelHeaderStyleValue;

  @ApiProperty({
    description: '생성일시',
    example: '2024-01-01T00:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: '수정일시',
    example: '2024-01-01T00:00:00.000Z',
  })
  updatedAt!: Date;
}

/**
 * 채널 커스터마이징 조회 응답 DTO (권한 정보 포함)
 */
export class ChannelCustomizationWithAccessResponseDto {
  @ApiPropertyOptional({
    description: '채널 커스터마이징 정보',
    type: ChannelCustomizationResponseDto,
    nullable: true,
  })
  customization?: ChannelCustomizationResponseDto | null;

  @ApiProperty({
    description: '요청자가 채널 소유자인지 여부',
    example: true,
  })
  isOwner!: boolean;

  @ApiProperty({
    description: '채널 소유자가 PRO 구독자인지 여부',
    example: false,
  })
  isOwnerPro!: boolean;

  @ApiProperty({
    description: 'CSS 저장 가능 여부 (소유자 Pro일 때만 true)',
    example: false,
  })
  canSave!: boolean;
}
