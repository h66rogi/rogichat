import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelPermission } from './guards/channel-permission.decorator';
import { ChannelPermissionGuard } from './guards/channel-permission.guard';
import { ChannelService } from './channel.service';
import { ChannelTransferService } from './channel-transfer.service';
import {
  RequestTransferDto,
  AcceptTransferDto,
  CheckTransferTargetDto,
} from './dto/channel-transfer.request.dto';
import {
  ChannelTransferIncomingListResponseDto,
  ChannelTransferOutgoingResponseDto,
  ChannelTransferResponseDto,
  MessageResponseDto,
  TransferTargetInfoDto,
} from './dto/channel.response.dto';

@ApiTags('ChannelTransfer')
@Controller('channel')
export class ChannelTransferController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly channelTransferService: ChannelTransferService,
  ) {}

  @ApiOperation({ summary: '채널 이전 대상자 검증' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 200, type: TransferTargetInfoDto })
  @Get('transfer/check-target')
  async checkTransferTarget(
    @Query() query: CheckTransferTargetDto,
    @Request() req,
  ): Promise<TransferTargetInfoDto> {
    const userId: number = Number(req.user.id);
    return this.channelTransferService.checkTransferTarget(query.email, userId);
  }

  @ApiOperation({ summary: '채널 이전 신청 (소유주)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('settings')
  @ApiParam({ name: 'identifier', description: '채널 ID 또는 webPath' })
  @ApiResponse({ status: 200, type: ChannelTransferResponseDto })
  @Post(':identifier/transfer')
  @HttpCode(HttpStatus.OK)
  async requestTransfer(
    @Param('identifier') identifier: string,
    @Body() dto: RequestTransferDto,
    @Request() req,
  ): Promise<ChannelTransferResponseDto> {
    const userId: number = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    const r = await this.channelTransferService.requestTransfer(
      channel.id,
      userId,
      dto,
    );
    return { requestId: r.requestId, status: r.status };
  }

  @ApiOperation({ summary: '채널 진행 중 이전 요청 조회 (소유주)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('settings')
  @ApiParam({ name: 'identifier', description: '채널 ID 또는 webPath' })
  @ApiResponse({ status: 200, type: ChannelTransferOutgoingResponseDto })
  @Get(':identifier/transfer/outgoing')
  async getOutgoingTransfer(
    @Param('identifier') identifier: string,
    @Request() req,
  ): Promise<ChannelTransferOutgoingResponseDto | null> {
    const userId: number = Number(req.user.id);
    const channel = await this.channelService.findByIdentifier(identifier);
    return this.channelTransferService.getOutgoingTransfer(channel.id, userId);
  }

  @ApiOperation({ summary: '채널 이전 요청 재알림 (소유주)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @Post('transfer/:requestId/remind')
  @HttpCode(HttpStatus.OK)
  async remindTransfer(
    @Param('requestId', ParseIntPipe) requestId: number,
    @Request() req,
  ): Promise<MessageResponseDto> {
    const userId: number = Number(req.user.id);
    return this.channelTransferService.remindTransfer(requestId, userId);
  }

  @ApiOperation({ summary: '채널 이전 신청 취소 (소유주)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @Delete('transfer/:requestId')
  @HttpCode(HttpStatus.OK)
  async cancelTransfer(
    @Param('requestId', ParseIntPipe) requestId: number,
    @Request() req,
  ): Promise<MessageResponseDto> {
    const userId: number = Number(req.user.id);
    return this.channelTransferService.cancelTransfer(requestId, userId);
  }

  @ApiOperation({ summary: '받은 채널 이전 요청 목록 조회 (수신자)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 200, type: ChannelTransferIncomingListResponseDto })
  @Get('transfer/incoming')
  async incomingRequests(
    @Request() req,
  ): Promise<ChannelTransferIncomingListResponseDto> {
    const userId: number = Number(req.user.id);
    return this.channelTransferService.getIncomingTransfers(userId);
  }

  @ApiOperation({ summary: '채널 이전 토큰 검증' })
  @ApiResponse({ status: 200 })
  @Get('transfer/:requestId/validate')
  async validateTransferToken(
    @Param('requestId', ParseIntPipe) requestId: number,
    @Query('token') token: string,
  ): Promise<{ valid: boolean }> {
    return this.channelTransferService.validateTransferToken(requestId, token);
  }

  @ApiOperation({ summary: '채널 이전 수락 (수신자)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 200, type: ChannelTransferResponseDto })
  @Post('transfer/:requestId/accept')
  @HttpCode(HttpStatus.OK)
  async acceptTransfer(
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() dto: AcceptTransferDto,
    @Request() req,
  ): Promise<ChannelTransferResponseDto> {
    const userId: number = Number(req.user.id);
    const r = await this.channelTransferService.acceptTransfer(
      requestId,
      dto,
      userId,
    );
    return { requestId: r.requestId, status: r.status };
  }

  @ApiOperation({ summary: '채널 이전 거절 (수신자)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @Post('transfer/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectTransfer(
    @Param('requestId', ParseIntPipe) requestId: number,
    @Request() req,
  ): Promise<MessageResponseDto> {
    const userId: number = Number(req.user.id);
    return this.channelTransferService.rejectTransfer(requestId, userId);
  }
}
