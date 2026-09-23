import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { ArtistService } from './artist.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateArtistDto, UpdateArtistDto } from './dto/artist.request.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { ChannelPermission } from '../channel/guards/channel-permission.decorator';
import { ChannelPermissionGuard } from '../channel/guards/channel-permission.guard';
import {
  ArtistDto,
  ArtistListItemDto,
  DeleteArtistResponseDto,
} from './dto/artist.response.dto';
import { toArtistDto, toArtistListItemDto } from './mappers/artist.mapper';

@ApiTags('Artists')
@Controller('artists')
export class ArtistController {
  constructor(private readonly artistService: ArtistService) {}

  @Get('public/:webPath')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '공개 노래책의 아티스트 목록 조회' })
  @ApiParam({
    name: 'webPath',
    description: '채널 주소',
    example: 'meloming_user',
  })
  @ApiResponse({
    status: 200,
    description: '아티스트 목록 반환',
    type: ArtistListItemDto,
    isArray: true,
  })
  @ApiResponse({ status: 404, description: '사용자를 찾을 수 없음' })
  async getPublicArtists(@Param('webPath') webPath: string) {
    const items = await this.artistService.getArtistsByWebPath(webPath);
    return items.map((a) => toArtistListItemDto(a));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Get('/channel/:channelId/artists')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '특정 뮤직북의 아티스트 목록 조회' })
  @ApiParam({
    name: 'channelId',
    type: Number,
    description: '뮤직북 ID',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: '아티스트 목록 조회 성공',
    type: ArtistListItemDto,
    isArray: true,
  })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '뮤직북 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '뮤직북을 찾을 수 없음' })
  async getArtistsByChannel(
    @Param('channelId', ParseIntPipe) channelId: number,
  ) {
    const items = await this.artistService.getArtistsByChannelId(channelId);
    return items.map((a) => toArtistListItemDto(a));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Post('/channel/:channelId/artists')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '특정 뮤직북에 아티스트 추가' })
  @ApiParam({
    name: 'channelId',
    type: Number,
    description: '뮤직북 ID',
    example: 1,
  })
  @ApiResponse({
    status: 201,
    description: '아티스트 생성 성공',
    type: ArtistDto,
  })
  @ApiBody({ type: CreateArtistDto })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '뮤직북 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '뮤직북을 찾을 수 없음' })
  async createArtistInChannel(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() createArtistDto: CreateArtistDto,
  ) {
    const created = await this.artistService.createArtistByChannelId(
      createArtistDto,
      channelId,
    );
    return toArtistDto({
      id: created.id,
      name: created.name,
      channelId: created.channelId,
      createdAt: created.createdAt,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Put('/channel/:channelId/artists/:artistId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '특정 뮤직북의 아티스트 수정' })
  @ApiParam({
    name: 'channelId',
    type: Number,
    description: '뮤직북 ID',
    example: 1,
  })
  @ApiParam({
    name: 'artistId',
    type: Number,
    description: '아티스트 ID',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: '아티스트 수정 성공',
    type: ArtistDto,
  })
  @ApiBody({ type: UpdateArtistDto })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '뮤직북 접근 권한 없음' })
  @ApiResponse({
    status: 404,
    description: '아티스트 또는 뮤직북을 찾을 수 없음',
  })
  async updateArtistInChannel(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('artistId', ParseIntPipe) artistId: number,
    @Body() updateArtistDto: UpdateArtistDto,
  ) {
    const updated = await this.artistService.updateArtistByChannelId(
      artistId,
      updateArtistDto,
      channelId,
    );
    return toArtistDto({
      id: updated.id,
      name: updated.name,
      channelId: updated.channelId,
      createdAt: updated.createdAt,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Delete('/channel/:channelId/artists/:artistId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '특정 뮤직북의 아티스트 삭제' })
  @ApiParam({
    name: 'channelId',
    type: Number,
    description: '뮤직북 ID',
    example: 1,
  })
  @ApiParam({
    name: 'artistId',
    type: Number,
    description: '아티스트 ID',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: '아티스트 삭제 성공',
    type: DeleteArtistResponseDto,
  })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '뮤직북 접근 권한 없음' })
  @ApiResponse({
    status: 404,
    description: '아티스트 또는 뮤직북을 찾을 수 없음',
  })
  async deleteArtistFromChannel(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('artistId', ParseIntPipe) artistId: number,
  ) {
    return this.artistService.deleteArtistByChannelId(artistId, channelId);
  }
}
