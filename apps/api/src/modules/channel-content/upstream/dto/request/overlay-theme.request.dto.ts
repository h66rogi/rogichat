import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  Validate,
  ValidatorConstraint,
} from 'class-validator';
import type { ValidationArguments, ValidatorConstraintInterface } from 'class-validator';
import { ALL_THEME_IDS, isValidThemeId } from '../../theme-manifest/theme-ids.js';

@ValidatorConstraint({ name: 'OverlayThemeId', async: false })
export class OverlayThemeIdValidator implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidThemeId(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `themeId must be one of: ${ALL_THEME_IDS.join(', ')} (received: ${String(args.value)})`;
  }
}

export class WidgetThemeDto {
  @ApiPropertyOptional({
    description: '위젯에 적용할 테마 ID. null이면 채널 기본값 상속.',
    example: 'spotify',
    nullable: true,
  })
  @IsOptional()
  @Validate(OverlayThemeIdValidator)
  themeId?: string | null;

  @ApiPropertyOptional({
    description: '위젯별 커스텀 옵션. null이면 채널 기본값 상속.',
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown> | null;
}

export class UpdateOverlayThemeDto {
  @ApiProperty({
    description: '채널 기본 테마 ID',
    example: 'glassmorphism',
    enum: ALL_THEME_IDS as unknown as string[],
  })
  @IsString()
  @Validate(OverlayThemeIdValidator)
  themeId!: string;

  @ApiPropertyOptional({
    description: '채널 기본 커스텀 옵션',
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      '위젯별 override. 키는 위젯 타입' +
      '(now-playing, queue, chatbox, setlist, lyrics, songbook-qr)',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  // class-validator의 @ValidateNested({ each: true })는 Array/Set/Map만
  // 순회하고 plain Record는 지원하지 않는다. 따라서 각 widget entry의
  // themeId/options shape 검증은 OverlayThemeService.updateThemeConfig의
  // 수동 루프에서 수행한다 (single source of truth).
  widgets?: Record<string, WidgetThemeDto>;
}
