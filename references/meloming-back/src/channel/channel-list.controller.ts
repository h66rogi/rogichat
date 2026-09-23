import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChannelService } from './channel.service';
import { ChannelListQueryDto } from './dto/channel.request.dto';
import { PopularChannelsQueryDto } from './dto/popular.request.dto';
import {
  ChannelWithCountsDto,
  ChannelWithCountsWithGroupDto,
  ChannelListAllResponseDto,
} from './dto/channel.response.dto';
import { toChannelWithCountsDto } from './mappers/channel.mapper';
import { getChoseong } from 'es-hangul';

@ApiTags('Channel')
@Controller({ path: 'channel/list', version: '1' })
export class ChannelListController {
  constructor(private readonly channelService: ChannelService) {}

  @Get('famous')
  @ApiOperation({
    summary: '인기 스트리머 목록 (가중치 기반)',
    description:
      '즐겨찾기 수 + 채널 내 노래 좋아요 수 + 등록 노래 수에 가중치를 적용하여 산정합니다. 최소 등록 노래 10곡 이상 채널만 대상이며, 결과는 1시간 캐시됩니다.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '조회 개수 (최대 50)',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: '인기 스트리머 목록',
    type: ChannelWithCountsDto,
    isArray: true,
  })
  async getFamous(
    @Query() query: PopularChannelsQueryDto,
  ): Promise<ChannelWithCountsDto[]> {
    const limit = query.limit ?? 10;
    const days = query.days;
    const weights = {
      fav: query.favoritesWeight ?? 1.5,
      like: query.songLikesWeight ?? 1.0,
      song: query.songsWeight ?? 0.1,
    };
    const channels = await this.channelService.listFamousChannels(limit, {
      days,
      weights,
    });
    return channels.map((c) => toChannelWithCountsDto(c));
  }

  @Get('recent')
  @ApiOperation({ summary: '최근 가입 스트리머 (노래 1개 이상 보유)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '조회 개수',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: '최근 가입 스트리머 목록',
    type: ChannelWithCountsDto,
    isArray: true,
  })
  async getRecent(
    @Query() query: ChannelListQueryDto,
  ): Promise<ChannelWithCountsDto[]> {
    const limit = query.limit ?? 10;
    const channels = await this.channelService.listRecentChannels(limit);
    return channels.map((c) => toChannelWithCountsDto(c));
  }

  @Get('global/popular')
  @ApiOperation({
    summary: 'meloming.gg 글로벌 인기 채널 (popularity 풀 random sample)',
    description:
      '인기 채널 풀(기본 100) 에서 globalProfile opt-out 필터 후 무작위로 limit 개 반환. 매 요청마다 순서가 다름.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 24 })
  @ApiQuery({
    name: 'pool',
    required: false,
    type: Number,
    description: '인기 채널 풀 크기 (기본 100, 최대 200)',
    example: 100,
  })
  async getGlobalPopular(
    @Query('limit') limitRaw?: string,
    @Query('pool') poolRaw?: string,
  ) {
    const limit = Number(limitRaw ?? '24') || 24;
    const pool = Number(poolRaw ?? '100') || 100;
    return this.channelService.listGlobalPopularChannels(limit, pool);
  }

  @Get('global/recent')
  @ApiOperation({
    summary: 'meloming.gg 글로벌 신규 등록 채널 (createdAt desc + opt-out 필터)',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 12 })
  async getGlobalRecent(@Query('limit') limitRaw?: string) {
    const limit = Number(limitRaw ?? '12') || 12;
    return this.channelService.listGlobalRecentChannels(limit);
  }

  @Get('global/search')
  @ApiOperation({
    summary: 'meloming.gg 글로벌 채널 검색',
    description:
      'globalProfile.globalEnabled = true 인 채널 중 keyword 가 globalName/name/webPath 에 contains.',
  })
  @ApiQuery({ name: 'keyword', required: true, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  async searchGlobal(
    @Query('keyword') keyword: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const page = Number(pageRaw ?? '1') || 1;
    const limit = Number(limitRaw ?? '20') || 20;
    return this.channelService.searchGlobalChannels(keyword ?? '', page, limit);
  }

  @Get('global')
  @ApiOperation({
    summary: 'meloming.gg 글로벌 노출 채널 목록',
    description:
      'globalProfile.globalEnabled = true 인 채널만 반환. 등록 노래 수 desc → 이름 asc 순.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: '조회 개수 (최대 50)',
    example: 20,
  })
  @ApiQuery({
    name: 'locale',
    required: false,
    type: String,
    description: 'primaryLocale 필터 (예: "en", "ja")',
  })
  async getGlobal(
    @Query() query: ChannelListQueryDto,
    @Query('locale') locale?: string,
  ) {
    const limit = query.limit ?? 20;
    return this.channelService.listGlobalChannels(limit, locale);
  }

  @Get('all')
  @ApiOperation({ summary: '노래 1개 이상 등록한 모든 스트리머' })
  @ApiResponse({
    status: 200,
    description: '모든 스트리머 목록 및 그룹 목록',
    type: ChannelListAllResponseDto,
  })
  async getAll(): Promise<ChannelListAllResponseDto> {
    const entities = await this.channelService.listAllChannelsWithSongs();
    const channels = entities.map((c) => {
      const dto = toChannelWithCountsDto(c) as ChannelWithCountsWithGroupDto;
      const firstChar = (dto.name || '').trim().charAt(0);
      dto.group = firstChar
        ? getChoseong(firstChar).charAt(0) || firstChar
        : '';
      return dto;
    });
    const hangulOrder = [
      'ㄱ',
      'ㄲ',
      'ㄴ',
      'ㄷ',
      'ㄸ',
      'ㄹ',
      'ㅁ',
      'ㅂ',
      'ㅃ',
      'ㅅ',
      'ㅆ',
      'ㅇ',
      'ㅈ',
      'ㅉ',
      'ㅊ',
      'ㅋ',
      'ㅌ',
      'ㅍ',
      'ㅎ',
    ];
    const classify = (ch: string) => {
      if (hangulOrder.includes(ch))
        return { cat: 0 as const, key: hangulOrder.indexOf(ch) };
      const lower = ch.toLowerCase();
      if (lower >= 'a' && lower <= 'z') return { cat: 1 as const, key: lower };
      if (ch >= '0' && ch <= '9') return { cat: 2 as const, key: ch };
      return { cat: 3 as const, key: ch };
    };
    const groups = Array.from(new Set(channels.map((c) => c.group))).sort(
      (a, b) => {
        const ca = classify(a || '');
        const cb = classify(b || '');
        if (ca.cat !== cb.cat) return ca.cat - cb.cat;
        if (typeof ca.key === 'number' && typeof cb.key === 'number')
          return ca.key - cb.key;
        const sa = String(ca.key);
        const sb = String(cb.key);
        return sa.localeCompare(sb);
      },
    );
    return { channels, groups };
  }
}
