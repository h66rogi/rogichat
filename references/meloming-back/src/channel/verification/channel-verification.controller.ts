import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
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
import { StreamPlatform } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelVerificationService } from './channel-verification.service';
import {
  CreateChannelVerificationDto,
  PreviewVerificationQueryDto,
} from './dto/channel-verification.request.dto';
import {
  ChannelVerificationDto,
  ChannelVerificationPreviewDto,
} from './dto/channel-verification.response.dto';
import { toChannelVerificationDto } from './mappers/channel-verification.mapper';

@ApiTags('ChannelVerification')
@Controller('channel')
export class ChannelVerificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelVerificationService: ChannelVerificationService,
  ) {}

  @ApiOperation({
    summary: '채널 인증 미리보기',
    description:
      '채널 인증 신청 전 자동 매칭 결과를 미리 확인합니다. 사용자의 플랫폼 인증 목록과 자동 인증 가능 여부를 반환합니다.',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'identifier', description: '채널 ID 또는 webPath' })
  @ApiResponse({ status: 200, type: ChannelVerificationPreviewDto })
  @Get(':identifier/verification/preview')
  async previewVerification(
    @Param('identifier') identifier: string,
    @Query() query: PreviewVerificationQueryDto,
    @Request() req,
  ): Promise<ChannelVerificationPreviewDto> {
    const userId: number = Number(req.user.id);
    const channel = await this.findChannelByIdentifier(identifier);
    return this.channelVerificationService.previewVerification(
      channel.id,
      userId,
      query.platform,
    );
  }

  @ApiOperation({
    summary: '채널 인증 신청',
    description:
      '채널 소유권 인증을 신청합니다. SOOP/CHZZK 플랫폼은 자동 검증을 시도하며, CIME/OTHER 플랫폼은 수동 심사로 진행됩니다.',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'identifier', description: '채널 ID 또는 webPath' })
  @ApiResponse({ status: 200, type: ChannelVerificationDto })
  @Post(':identifier/verification')
  @HttpCode(HttpStatus.OK)
  async createVerification(
    @Param('identifier') identifier: string,
    @Body() dto: CreateChannelVerificationDto,
    @Request() req,
  ): Promise<ChannelVerificationDto> {
    const userId: number = Number(req.user.id);
    const channel = await this.findChannelByIdentifier(identifier);
    const verification =
      await this.channelVerificationService.createVerification(
        channel.id,
        userId,
        dto,
      );
    return toChannelVerificationDto(verification);
  }

  @ApiOperation({
    summary: '채널 인증 상태 조회',
    description:
      '채널의 인증 상태를 조회합니다. 채널 소유자만 조회할 수 있습니다. 활성 인증 목록을 반환합니다.',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'identifier', description: '채널 ID 또는 webPath' })
  @ApiResponse({ status: 200, type: [ChannelVerificationDto] })
  @Get(':identifier/verification')
  async getVerifications(
    @Param('identifier') identifier: string,
    @Request() req,
  ): Promise<ChannelVerificationDto[]> {
    const userId: number = Number(req.user.id);
    const channel = await this.findChannelByIdentifier(identifier);
    const verifications =
      await this.channelVerificationService.getVerifications(
        channel.id,
        userId,
      );
    return verifications.map((v) => toChannelVerificationDto(v));
  }

  @ApiOperation({
    summary: '채널 인증 해제',
    description:
      '특정 플랫폼의 채널 인증을 해제합니다. 채널 소유자만 해제할 수 있습니다.',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: 'identifier', description: '채널 ID 또는 webPath' })
  @ApiParam({
    name: 'platform',
    description: '해제할 플랫폼',
    enum: ['SOOP', 'CHZZK', 'CIME', 'OTHER'],
  })
  @Delete(':identifier/verification/:platform')
  async revokeVerification(
    @Param('identifier') identifier: string,
    @Param('platform') platform: StreamPlatform,
    @Request() req,
  ): Promise<void> {
    const userId = Number(req.user.id);
    const channel = await this.findChannelByIdentifier(identifier);
    await this.channelVerificationService.revokeVerification(
      channel.id,
      userId,
      platform,
    );
  }

  private async findChannelByIdentifier(identifier: string) {
    const isNumeric = /^\d+$/.test(identifier);
    const channel = await this.prisma.channel.findFirst({
      where: isNumeric
        ? { id: parseInt(identifier, 10) }
        : { webPath: identifier.toLowerCase() },
      select: { id: true },
    });
    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }
    return channel;
  }
}
