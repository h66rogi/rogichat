import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOverlayWidgetCssDto {
  @ApiProperty({ description: '위젯 커스텀 CSS', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100 * 1024, { message: 'CSS는 최대 100KB까지 허용됩니다.' })
  customCss?: string;

  @ApiPropertyOptional({ description: '활성화 여부', example: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class ToggleOverlayWidgetCssEnabledDto {
  @ApiProperty({ description: '활성화 여부', example: true })
  @IsBoolean()
  isEnabled!: boolean;
}
