import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SongAddRequestService } from './song-add-request.service';
import { SongAddRequestCreateDto } from './dto/requests/song-add-request-create.dto';
import { SongAddRequestApproveDto } from './dto/requests/song-add-request-approve.dto';
import { SongAddRequestRejectDto } from './dto/requests/song-add-request-reject.dto';
import { SongAddRequestListQueryDto } from './dto/requests/song-add-request-list.query.dto';
import { ChannelSongPermissionResponseDto } from './dto/responses/channel-song-permission.response.dto';
import {
  SongAddRequestResponseDto,
  SongAddRequestListResponseDto,
} from './dto/responses/song-add-request.response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IdentityVerifiedGuard } from '../auth/guards/identity-verified.guard';
import { AuthUser } from '../common/decorators/auth-user.decorator';
import { AuthUserDto } from '../common/dto/auth-user.dto';

@ApiTags('Song Add Requests')
@Controller('songs')
export class SongAddRequestController {
  constructor(private readonly songAddRequestService: SongAddRequestService) {}

  @Get('channels/:channelId/permission')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '채널 노래 등록 권한 체크' })
  @ApiResponse({ status: 200, type: ChannelSongPermissionResponseDto })
  async checkChannelPermission(
    @AuthUser() user: AuthUserDto,
    @Param('channelId', ParseIntPipe) channelId: number,
  ): Promise<ChannelSongPermissionResponseDto> {
    return this.songAddRequestService.checkChannelPermission(
      user.id,
      channelId,
    );
  }

  @Post('requests')
  @UseGuards(JwtAuthGuard, IdentityVerifiedGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '노래 등록 신청 (본인인증 필요)' })
  @ApiResponse({ status: 201, type: SongAddRequestResponseDto })
  async createRequest(
    @AuthUser() user: AuthUserDto,
    @Body() dto: SongAddRequestCreateDto,
  ): Promise<SongAddRequestResponseDto> {
    return this.songAddRequestService.createRequest(user.id, dto);
  }

  @Get('requests/my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 노래 신청 목록 조회' })
  @ApiResponse({ status: 200, type: SongAddRequestListResponseDto })
  async getMyRequests(
    @AuthUser() user: AuthUserDto,
    @Query() query: SongAddRequestListQueryDto,
  ): Promise<SongAddRequestListResponseDto> {
    return this.songAddRequestService.getMyRequests(user.id, query);
  }

  @Get('requests/channel/:channelId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '채널 노래 신청 목록 조회 (채널 관리자용)' })
  @ApiResponse({ status: 200, type: SongAddRequestListResponseDto })
  async getChannelRequests(
    @AuthUser() user: AuthUserDto,
    @Param('channelId', ParseIntPipe) channelId: number,
    @Query() query: SongAddRequestListQueryDto,
  ): Promise<SongAddRequestListResponseDto> {
    return this.songAddRequestService.getChannelRequests(
      user.id,
      channelId,
      query,
    );
  }

  @Patch('requests/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '노래 신청 승인 (수정 값 포함 가능)' })
  @ApiResponse({ status: 200, type: SongAddRequestResponseDto })
  async approveRequest(
    @AuthUser() user: AuthUserDto,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto?: SongAddRequestApproveDto,
  ): Promise<SongAddRequestResponseDto> {
    return this.songAddRequestService.approveRequest(user.id, id, dto);
  }

  @Patch('requests/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '노래 신청 거절' })
  @ApiResponse({ status: 200, type: SongAddRequestResponseDto })
  async rejectRequest(
    @AuthUser() user: AuthUserDto,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SongAddRequestRejectDto,
  ): Promise<SongAddRequestResponseDto> {
    return this.songAddRequestService.rejectRequest(user.id, id, dto);
  }

  @Delete('requests/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '노래 신청 취소 (신청자 본인만)' })
  @ApiResponse({ status: 200, type: SongAddRequestResponseDto })
  async cancelRequest(
    @AuthUser() user: AuthUserDto,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SongAddRequestResponseDto> {
    return this.songAddRequestService.cancelRequest(user.id, id);
  }
}
