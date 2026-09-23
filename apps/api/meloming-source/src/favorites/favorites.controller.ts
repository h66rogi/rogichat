import {
  Controller,
  Get,
  Put,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FavoritesService } from './favorites.service';
import {
  MyFavoritesQueryDto,
  ReorderChannelFavoritesDto,
} from './dto/favorites.request.dto';
import {
  FavoriteToggleResponseDto,
  MyChannelFavoritesResponseDto,
  MySongFavoritesResponseDto,
  FavoriteStatusDto,
  FavoriteStatsDto,
  SongFavoriteCountDto,
  ChannelFavoriteCountDto,
  ChannelFavoritedUsersResponseDto,
  FavoriteChannelAnniversariesResponseDto,
} from './dto/favorites.response.dto';
import {
  toChannelFavoriteDto,
  toSongFavoriteDto,
} from './mappers/favorites.mapper';
import { ChannelOwnershipGuard } from '../channel/guards/channel-ownership.guard';

@ApiTags('Favorites')
@Controller('favorites')
@ApiBearerAuth()
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Put('channels/:channelId/add')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '채널 즐겨찾기 추가',
    description: '이미 즐겨찾기한 채널도 해제하지 않는 멱등 추가 API입니다.',
  })
  @ApiParam({ name: 'channelId', type: 'number', example: 5 })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 추가 또는 기존 상태 유지 성공',
    type: FavoriteToggleResponseDto,
  })
  async addChannelFavorite(
    @Request() req,
    @Param('channelId', ParseIntPipe) channelId: number,
  ): Promise<FavoriteToggleResponseDto> {
    return this.favoritesService.addChannelFavorite(
      Number(req.user.id),
      channelId,
    );
  }

  // 채널 즐겨찾기 토글
  @Put('channels/:channelId')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '채널 즐겨찾기 토글',
    description: '채널을 즐겨찾기에 추가하거나 해제합니다.',
  })
  @ApiParam({
    name: 'channelId',
    description: '채널 ID',
    type: 'number',
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 토글 성공',
    type: FavoriteToggleResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '채널을 찾을 수 없음',
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
  })
  async toggleChannelFavorite(
    @Request() req,
    @Param('channelId', ParseIntPipe) channelId: number,
  ): Promise<FavoriteToggleResponseDto> {
    const userId: number = Number(req.user.id);
    const result = await this.favoritesService.toggleChannelFavorite(
      userId,
      channelId,
    );
    return result;
  }

  // 즐겨찾기 채널 순서 변경
  @Patch('channels/reorder')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: '즐겨찾기 채널 순서 변경' })
  @ApiBody({ type: ReorderChannelFavoritesDto })
  @ApiResponse({
    status: 200,
    description: '순서 변경 성공',
  })
  async reorderChannelFavorites(
    @Request() req,
    @Body() dto: ReorderChannelFavoritesDto,
  ) {
    const userId = req.user.id;
    return this.favoritesService.reorderChannelFavorites(
      userId,
      dto.channelIds,
    );
  }

  // 노래 즐겨찾기 토글
  @Put('songs/:songId')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '노래 즐겨찾기 토글',
    description: '노래를 즐겨찾기에 추가하거나 해제합니다.',
  })
  @ApiParam({
    name: 'songId',
    description: '노래 ID',
    type: 'number',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 토글 성공',
    type: FavoriteToggleResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '노래를 찾을 수 없음',
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
  })
  async toggleSongFavorite(
    @Request() req,
    @Param('songId', ParseIntPipe) songId: number,
  ): Promise<FavoriteToggleResponseDto> {
    const userId: number = Number(req.user.id);
    const result = await this.favoritesService.toggleSongFavorite(
      userId,
      songId,
    );
    return result;
  }

  // 내 즐겨찾기 채널 목록
  @Get('channels')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '내 즐겨찾기 채널 목록',
    description: '내가 즐겨찾기한 채널 목록을 조회합니다.',
  })
  @ApiQuery({
    name: 'page',
    description: '페이지 번호',
    type: 'number',
    required: false,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    description: '페이지당 항목 수',
    type: 'number',
    required: false,
    example: 20,
  })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 채널 목록 조회 성공',
    type: MyChannelFavoritesResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
  })
  async getMyChannelFavorites(
    @Request() req,
    @Query() query: MyFavoritesQueryDto,
  ): Promise<MyChannelFavoritesResponseDto> {
    const userId: number = Number(req.user.id);
    const { favorites, total, page, limit, totalPages } =
      await this.favoritesService.getMyChannelFavorites(userId, query);

    return {
      favorites: favorites.map(toChannelFavoriteDto),
      total,
      page,
      limit,
      totalPages,
    };
  }

  // 내 즐겨찾기 노래 목록
  @Get('songs')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '내 즐겨찾기 노래 목록',
    description: '내가 즐겨찾기한 노래 목록을 조회합니다.',
  })
  @ApiQuery({
    name: 'page',
    description: '페이지 번호',
    type: 'number',
    required: false,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    description: '페이지당 항목 수',
    type: 'number',
    required: false,
    example: 20,
  })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 노래 목록 조회 성공',
    type: MySongFavoritesResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
  })
  async getMySongFavorites(
    @Request() req,
    @Query() query: MyFavoritesQueryDto,
  ): Promise<MySongFavoritesResponseDto> {
    const userId: number = Number(req.user.id);
    const { favorites, total, page, limit, totalPages } =
      await this.favoritesService.getMySongFavorites(userId, query);

    return {
      favorites: favorites.map(toSongFavoriteDto),
      total,
      page,
      limit,
      totalPages,
    };
  }

  // 채널 즐겨찾기 상태 확인
  @Get('channels/:channelId/status')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '채널 즐겨찾기 상태 확인',
    description: '특정 채널의 즐겨찾기 상태를 확인합니다.',
  })
  @ApiParam({
    name: 'channelId',
    description: '채널 ID',
    type: 'number',
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 상태 조회 성공',
    type: FavoriteStatusDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
  })
  async getChannelFavoriteStatus(
    @Request() req,
    @Param('channelId', ParseIntPipe) channelId: number,
  ): Promise<FavoriteStatusDto> {
    const userId: number = Number(req.user.id);
    const result = await this.favoritesService.getChannelFavoriteStatus(
      userId,
      channelId,
    );
    return result;
  }

  // 노래 즐겨찾기 상태 확인
  @Get('songs/:songId/status')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '노래 즐겨찾기 상태 확인',
    description: '특정 노래의 즐겨찾기 상태를 확인합니다.',
  })
  @ApiParam({
    name: 'songId',
    description: '노래 ID',
    type: 'number',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 상태 조회 성공',
    type: FavoriteStatusDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
  })
  async getSongFavoriteStatus(
    @Request() req,
    @Param('songId', ParseIntPipe) songId: number,
  ): Promise<FavoriteStatusDto> {
    const userId: number = Number(req.user.id);
    const result = await this.favoritesService.getSongFavoriteStatus(
      userId,
      songId,
    );
    return result;
  }

  // 즐겨찾기 통계
  @Get('stats')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '내 즐겨찾기 통계',
    description: '내 즐겨찾기 통계를 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 통계 조회 성공',
    type: FavoriteStatsDto,
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
  })
  async getFavoriteStats(@Request() req): Promise<FavoriteStatsDto> {
    const userId: number = Number(req.user.id);
    const result = await this.favoritesService.getFavoriteStats(userId);
    return result;
  }

  // 채널 즐겨찾기 해제
  @Delete('channels/:channelId')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '채널 즐겨찾기 해제',
    description: '채널을 즐겨찾기에서 해제합니다.',
  })
  @ApiParam({
    name: 'channelId',
    description: '채널 ID',
    type: 'number',
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 해제 성공',
    type: FavoriteToggleResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '즐겨찾기 항목을 찾을 수 없음',
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
  })
  async removeChannelFavorite(
    @Request() req,
    @Param('channelId', ParseIntPipe) channelId: number,
  ): Promise<FavoriteToggleResponseDto> {
    const userId: number = Number(req.user.id);
    const result = await this.favoritesService.removeChannelFavorite(
      userId,
      channelId,
    );
    return result;
  }

  // 노래 즐겨찾기 해제
  @Delete('songs/:songId')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '노래 즐겨찾기 해제',
    description: '노래 즐겨찾기를 해제합니다.',
  })
  @ApiParam({
    name: 'songId',
    description: '노래 ID',
    type: 'number',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 해제 성공',
    type: FavoriteToggleResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '즐겨찾기 항목을 찾을 수 없음',
  })
  @ApiResponse({
    status: 401,
    description: '인증 실패',
  })
  async removeSongFavorite(
    @Request() req,
    @Param('songId', ParseIntPipe) songId: number,
  ): Promise<FavoriteToggleResponseDto> {
    const userId: number = Number(req.user.id);
    const result = await this.favoritesService.removeSongFavorite(
      userId,
      songId,
    );
    return result;
  }

  // 노래 총 즐겨찾기 수 조회 (공개 API)
  @Get('songs/:songId/count')
  @ApiOperation({
    summary: '노래 총 즐겨찾기 수 조회',
    description: '특정 노래의 전체 즐겨찾기 수를 조회합니다.',
  })
  @ApiParam({
    name: 'songId',
    description: '노래 ID',
    type: 'number',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: '노래 즐겨찾기 수 조회 성공',
    type: SongFavoriteCountDto,
  })
  @ApiResponse({
    status: 404,
    description: '노래를 찾을 수 없음',
  })
  async getSongFavoriteCount(
    @Param('songId', ParseIntPipe) songId: number,
  ): Promise<SongFavoriteCountDto> {
    const result = await this.favoritesService.getSongFavoriteCount(songId);
    return result;
  }

  // 채널 총 즐겨찾기 수 조회 (공개 API)
  @Get('channels/:channelId/count')
  @ApiOperation({
    summary: '채널 총 즐겨찾기 수 조회',
    description: '특정 채널의 전체 즐겨찾기 수를 조회합니다.',
  })
  @ApiParam({
    name: 'channelId',
    description: '채널 ID',
    type: 'number',
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: '채널 즐겨찾기 수 조회 성공',
    type: ChannelFavoriteCountDto,
  })
  @ApiResponse({
    status: 404,
    description: '채널을 찾을 수 없음',
  })
  async getChannelFavoriteCount(
    @Param('channelId', ParseIntPipe) channelId: number,
  ): Promise<ChannelFavoriteCountDto> {
    const result =
      await this.favoritesService.getChannelFavoriteCount(channelId);
    return result;
  }

  // 채널 즐겨찾기한 사용자 목록 (소유자/매니저: content 권한)
  @Get('channels/:channelId/users')
  @UseGuards(AuthGuard('jwt'), ChannelOwnershipGuard)
  @ApiOperation({ summary: '채널 즐겨찾기한 사용자 목록' })
  @ApiParam({
    name: 'channelId',
    description: '채널 ID',
    type: 'number',
    example: 5,
  })
  @ApiQuery({
    name: 'page',
    description: '페이지 번호',
    type: 'number',
    required: false,
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    description: '페이지당 항목 수',
    type: 'number',
    required: false,
    example: 20,
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    type: ChannelFavoritedUsersResponseDto,
  })
  async getChannelFavoritedUsers(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Query() query: MyFavoritesQueryDto,
  ): Promise<ChannelFavoritedUsersResponseDto> {
    const { page = 1, limit = 20 } = query;
    return await this.favoritesService.getChannelFavoritedUsers(
      channelId,
      page,
      limit,
    );
  }

  @Get('channels/anniversaries')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '내 즐겨찾기 채널 기념일 목록',
    description:
      '내가 즐겨찾기한 채널들의 프로필 기념일 요약 정보를 한 번에 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '즐겨찾기 채널 기념일 목록 조회 성공',
    type: FavoriteChannelAnniversariesResponseDto,
  })
  async getMyFavoriteChannelAnniversaries(
    @Request() req,
  ): Promise<FavoriteChannelAnniversariesResponseDto> {
    const userId: number = Number(req.user.id);
    return this.favoritesService.getMyFavoriteChannelAnniversaries(userId);
  }
}
