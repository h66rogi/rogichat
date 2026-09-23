import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OVERLAY_WIDGET_TYPE_VALUES,
  type OverlayWidgetTypeValue,
} from '../constants/overlay-widget-type';

export class OverlayWidgetCssResponseDto {
  @ApiProperty() id!: number;
  @ApiProperty() channelId!: number;
  @ApiProperty({ enum: OVERLAY_WIDGET_TYPE_VALUES })
  widgetType!: OverlayWidgetTypeValue;
  @ApiPropertyOptional({ nullable: true }) customCss?: string | null;
  @ApiProperty() isEnabled!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class OverlayWidgetCssWithAccessResponseDto {
  @ApiPropertyOptional({ type: OverlayWidgetCssResponseDto, nullable: true })
  customization?: OverlayWidgetCssResponseDto | null;
  @ApiProperty() isOwner!: boolean;
  @ApiProperty() isOwnerPro!: boolean;
  @ApiProperty() canSave!: boolean;
}

export class OverlayWidgetCssListResponseDto {
  @ApiProperty({ type: [OverlayWidgetCssResponseDto] })
  items!: OverlayWidgetCssResponseDto[];
  @ApiProperty() isOwner!: boolean;
  @ApiProperty() isOwnerPro!: boolean;
  @ApiProperty() canSave!: boolean;
}
