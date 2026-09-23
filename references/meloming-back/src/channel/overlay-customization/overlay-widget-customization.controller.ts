import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ChannelPermission } from '../guards/channel-permission.decorator';
import { ChannelPermissionGuard } from '../guards/channel-permission.guard';
import { ChannelService } from '../channel.service';
import { OverlayWidgetCustomizationService } from './overlay-widget-customization.service';
import {
  ToggleOverlayWidgetCssEnabledDto,
  UpdateOverlayWidgetCssDto,
} from './dto/overlay-widget-css.request.dto';
import {
  OverlayWidgetCssListResponseDto,
  OverlayWidgetCssResponseDto,
  OverlayWidgetCssWithAccessResponseDto,
} from './dto/overlay-widget-css.response.dto';
import {
  toOverlayWidgetCssListResponseDto,
  toOverlayWidgetCssResponseDto,
  toOverlayWidgetCssWithAccessResponseDto,
} from './mappers/overlay-widget-customization.mapper';
import {
  OVERLAY_WIDGET_TYPE_VALUES,
  type OverlayWidgetTypeValue,
} from './constants/overlay-widget-type';
import { ParseOverlayWidgetTypePipe } from './pipes/parse-overlay-widget-type.pipe';

@ApiTags('Channel/OverlayCustomization')
@Controller('channel')
export class OverlayWidgetCustomizationController {
  constructor(
    private readonly service: OverlayWidgetCustomizationService,
    private readonly channelService: ChannelService,
  ) {}

  @Get(':identifier/overlay-customization/css')
  @ApiOperation({ summary: '모든 위젯 커스텀 CSS 조회' })
  @ApiParam({ name: 'identifier', type: 'string' })
  @ApiResponse({ status: 200, type: OverlayWidgetCssListResponseDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('customization')
  async getAll(
    @Param('identifier') identifier: string,
    @Request() req,
  ): Promise<OverlayWidgetCssListResponseDto> {
    const userId = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    const data = await this.service.getAll(channel.id, userId);
    return toOverlayWidgetCssListResponseDto(data);
  }

  @Get(':identifier/overlay-customization/css/:widget')
  @ApiOperation({ summary: '단일 위젯 커스텀 CSS 조회' })
  @ApiParam({ name: 'identifier', type: 'string' })
  @ApiParam({ name: 'widget', enum: OVERLAY_WIDGET_TYPE_VALUES })
  @ApiResponse({ status: 200, type: OverlayWidgetCssWithAccessResponseDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('customization')
  async getOne(
    @Param('identifier') identifier: string,
    @Param('widget', ParseOverlayWidgetTypePipe) widget: OverlayWidgetTypeValue,
    @Request() req,
  ): Promise<OverlayWidgetCssWithAccessResponseDto> {
    const userId = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    const data = await this.service.getOne(channel.id, userId, widget);
    return toOverlayWidgetCssWithAccessResponseDto(data);
  }

  @Put(':identifier/overlay-customization/css/:widget')
  @ApiOperation({ summary: '위젯 커스텀 CSS 저장/수정' })
  @ApiParam({ name: 'identifier', type: 'string' })
  @ApiParam({ name: 'widget', enum: OVERLAY_WIDGET_TYPE_VALUES })
  @ApiResponse({ status: 200, type: OverlayWidgetCssResponseDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('customization')
  async upsert(
    @Param('identifier') identifier: string,
    @Param('widget', ParseOverlayWidgetTypePipe) widget: OverlayWidgetTypeValue,
    @Body() dto: UpdateOverlayWidgetCssDto,
    @Request() req,
  ): Promise<OverlayWidgetCssResponseDto> {
    const userId = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    const entity = await this.service.upsertCss(
      channel.id,
      userId,
      widget,
      dto,
    );
    return toOverlayWidgetCssResponseDto(entity);
  }

  @Patch(':identifier/overlay-customization/css/:widget/enable')
  @ApiOperation({ summary: '위젯 커스텀 CSS 활성화/비활성화' })
  @ApiParam({ name: 'identifier', type: 'string' })
  @ApiParam({ name: 'widget', enum: OVERLAY_WIDGET_TYPE_VALUES })
  @ApiResponse({ status: 200, type: OverlayWidgetCssResponseDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('customization')
  async toggle(
    @Param('identifier') identifier: string,
    @Param('widget', ParseOverlayWidgetTypePipe) widget: OverlayWidgetTypeValue,
    @Body() dto: ToggleOverlayWidgetCssEnabledDto,
    @Request() req,
  ): Promise<OverlayWidgetCssResponseDto> {
    const userId = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    const entity = await this.service.toggleEnabled(
      channel.id,
      userId,
      widget,
      dto.isEnabled,
    );
    return toOverlayWidgetCssResponseDto(entity);
  }

  @Delete(':identifier/overlay-customization/css/:widget')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '위젯 커스텀 CSS 삭제' })
  @ApiParam({ name: 'identifier', type: 'string' })
  @ApiParam({ name: 'widget', enum: OVERLAY_WIDGET_TYPE_VALUES })
  @ApiResponse({ status: 204 })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('customization')
  async remove(
    @Param('identifier') identifier: string,
    @Param('widget', ParseOverlayWidgetTypePipe) widget: OverlayWidgetTypeValue,
    @Request() req,
  ): Promise<void> {
    const userId = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    await this.service.deleteCss(channel.id, userId, widget);
  }
}
