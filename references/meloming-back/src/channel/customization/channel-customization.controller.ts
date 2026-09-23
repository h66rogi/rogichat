import {
  Controller,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ChannelPermission } from '../guards/channel-permission.decorator';
import { ChannelPermissionGuard } from '../guards/channel-permission.guard';
import { ChannelCustomizationService } from './channel-customization.service';
import {
  UpdateCssDto,
  ToggleCssEnabledDto,
} from './dto/customization.request.dto';
import {
  ChannelCustomizationResponseDto,
  ChannelCustomizationWithAccessResponseDto,
} from './dto/customization.response.dto';
import {
  toChannelCustomizationResponseDto,
  toChannelCustomizationWithAccessResponseDto,
} from './mappers/customization.mapper';
import { ChannelService } from '../channel.service';

@ApiTags('Channel/Customization')
@Controller('channel')
export class ChannelCustomizationController {
  constructor(
    private readonly customizationService: ChannelCustomizationService,
    private readonly channelService: ChannelService,
  ) {}

  @Get(':identifier/customization/css')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '커스텀 CSS 조회',
    description:
      '채널 소유자는 PRO 구독 여부와 관계없이 조회 가능 (Preview 모드). 매니저는 채널 소유자가 PRO일 때만 조회 가능.',
  })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 조회' },
      webPath: { value: 'my_channel', description: 'webPath로 조회' },
    },
  })
  @ApiResponse({
    status: 200,
    description: '커스텀 CSS 조회 성공 (권한 정보 포함)',
    type: ChannelCustomizationWithAccessResponseDto,
  })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('customization')
  async getCss(
    @Param('identifier') identifier: string,
    @Request() req,
  ): Promise<ChannelCustomizationWithAccessResponseDto> {
    const userId: number = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    const result = await this.customizationService.getCss(channel.id, userId);

    return toChannelCustomizationWithAccessResponseDto(result);
  }

  @Put(':identifier/customization/css')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '커스텀 CSS 저장/수정' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 저장' },
      webPath: { value: 'my_channel', description: 'webPath로 저장' },
    },
  })
  @ApiResponse({
    status: 200,
    description: '커스텀 CSS 저장/수정 성공',
    type: ChannelCustomizationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'CSS 검증 실패' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('customization')
  async updateCss(
    @Param('identifier') identifier: string,
    @Body() updateDto: UpdateCssDto,
    @Request() req,
  ): Promise<ChannelCustomizationResponseDto> {
    const userId: number = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    const customization = await this.customizationService.updateCss(
      channel.id,
      userId,
      updateDto,
    );

    return toChannelCustomizationResponseDto(customization);
  }

  @Patch(':identifier/customization/css/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '커스텀 CSS 활성화/비활성화' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 활성화/비활성화' },
      webPath: {
        value: 'my_channel',
        description: 'webPath로 활성화/비활성화',
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '커스텀 CSS 활성화/비활성화 성공',
    type: ChannelCustomizationResponseDto,
  })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('customization')
  async toggleEnabled(
    @Param('identifier') identifier: string,
    @Body() toggleDto: ToggleCssEnabledDto,
    @Request() req,
  ): Promise<ChannelCustomizationResponseDto> {
    const userId: number = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    const customization = await this.customizationService.toggleEnabled(
      channel.id,
      userId,
      toggleDto.isEnabled,
    );

    return toChannelCustomizationResponseDto(customization);
  }

  @Delete(':identifier/customization/css')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '커스텀 CSS 삭제' })
  @ApiParam({
    name: 'identifier',
    type: 'string',
    description: '채널 ID (숫자) 또는 채널 주소 (문자)',
    examples: {
      channelId: { value: '123', description: '채널 ID로 삭제' },
      webPath: { value: 'my_channel', description: 'webPath로 삭제' },
    },
  })
  @ApiResponse({
    status: 204,
    description: '커스텀 CSS 삭제 성공',
  })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('customization')
  async deleteCss(
    @Param('identifier') identifier: string,
    @Request() req,
  ): Promise<void> {
    const userId: number = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    await this.customizationService.deleteCss(channel.id, userId);
  }
}
