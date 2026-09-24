import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ThemeCatalogEntry } from '../../theme-manifest/types.js';

export class WidgetThemeResponseDto {
  @ApiPropertyOptional({ nullable: true })
  themeId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  options!: Record<string, unknown> | null;
}

export class DefaultThemeResponseDto {
  @ApiProperty()
  themeId!: string;

  @ApiProperty()
  options!: Record<string, unknown>;
}

export class OverlayThemeResponseDto {
  @ApiProperty()
  default!: DefaultThemeResponseDto;

  @ApiProperty({ type: 'object', additionalProperties: true })
  widgets!: Record<string, WidgetThemeResponseDto>;
}

export class ThemeCatalogResponseDto {
  @ApiProperty({ isArray: true, type: 'object', additionalProperties: true })
  themes!: ThemeCatalogEntry[];
}

export class ThemeCatalogDetailResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  theme!: ThemeCatalogEntry;
}
