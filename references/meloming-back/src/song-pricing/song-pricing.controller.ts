import {
  Controller,
  Get,
  Put,
  Patch,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ChannelVerificationStatus } from '@prisma/client';
import { SongPricingService } from './song-pricing.service';
import { ChannelOwnershipGuard } from '../channel/guards/channel-ownership.guard';
import { UpdatePricingSettingsDto } from './dto/request/update-pricing-settings.dto';
import { UpdateSongPriceDto } from './dto/request/update-song-price.dto';
import { UpdateCategoryPriceDto } from './dto/request/update-category-price.dto';
import { CalculatePricesDto } from './dto/request/calculate-prices.dto';
import { CalculatedPriceResponseDto } from './dto/response/calculated-price.response.dto';
import { PricingSettingsResponseDto } from './dto/response/pricing-settings.response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';
import {
  CurrencyPriceMap,
  DifficultyPrices,
  DifficultyPricesByCurrency,
} from './types/pricing.types';

@ApiTags('Song Pricing')
@Controller('channels/:channelId')
export class SongPricingController {
  constructor(
    private readonly songPricingService: SongPricingService,
    private readonly prisma: PrismaService,
    private readonly cacheTracker: CacheKeyTrackingService,
  ) {}

  @Get('pricing-settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '채널 가격 설정 조회',
    description: '채널의 신청곡 가격 설정을 조회합니다.',
  })
  @ApiParam({ name: 'channelId', type: Number, description: '채널 ID' })
  @ApiResponse({
    status: 200,
    description: '가격 설정 조회 성공',
    type: PricingSettingsResponseDto,
  })
  async getPricingSettings(
    @Param('channelId', ParseIntPipe) channelId: number,
  ): Promise<PricingSettingsResponseDto> {
    const settings =
      await this.songPricingService.getPricingSettings(channelId);
    const platform = await this.getChannelPlatform(channelId);
    const pricingData = settings
      ? this.songPricingService.extractPricingData(settings)
      : {
          difficultyPrices: null,
          difficultyPricesByCurrency: null,
          defaultPrices: null,
          currencyConfigs: [],
        };

    if (!settings) {
      const currencyUnit = this.songPricingService.resolveCurrencyUnit(
        platform,
        pricingData.currencyConfigs,
      );
      return {
        channelId,
        pricingEnabled: false,
        defaultPrice: null,
        defaultPrices: null,
        difficultyPrices: null,
        difficultyPricesByCurrency: null,
        currencyUnit,
        currencyConfigs: [],
      };
    }

    const currencyKey = this.songPricingService.resolveCurrencyKey(
      platform,
      pricingData.currencyConfigs,
      [pricingData.defaultPrices],
    );
    const legacyDefaultPrice =
      settings.defaultPrice ??
      (currencyKey && pricingData.defaultPrices
        ? (pricingData.defaultPrices[currencyKey] ?? null)
        : null);
    const legacyDifficulty =
      currencyKey && pricingData.difficultyPricesByCurrency?.[currencyKey]
        ? pricingData.difficultyPricesByCurrency[currencyKey]
        : pricingData.difficultyPrices;
    const currencyUnit = this.songPricingService.resolveCurrencyUnit(
      platform,
      pricingData.currencyConfigs,
      currencyKey,
    );

    return {
      channelId: settings.channelId,
      pricingEnabled: settings.pricingEnabled,
      defaultPrice: legacyDefaultPrice,
      defaultPrices: pricingData.defaultPrices,
      difficultyPrices: legacyDifficulty,
      difficultyPricesByCurrency: pricingData.difficultyPricesByCurrency,
      currencyUnit,
      currencyConfigs: pricingData.currencyConfigs,
    };
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelOwnershipGuard)
  @Put('pricing-settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '채널 가격 설정 업데이트',
    description:
      '채널의 신청곡 가격 설정을 업데이트합니다. 채널 소유자만 가능합니다.',
  })
  @ApiParam({ name: 'channelId', type: Number, description: '채널 ID' })
  @ApiResponse({
    status: 200,
    description: '가격 설정 업데이트 성공',
    type: PricingSettingsResponseDto,
  })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  async updatePricingSettings(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() dto: UpdatePricingSettingsDto,
  ): Promise<PricingSettingsResponseDto> {
    const settings = await this.songPricingService.updatePricingSettings(
      channelId,
      dto,
    );
    const platform = await this.getChannelPlatform(channelId);
    const pricingData = this.songPricingService.extractPricingData(settings);
    const currencyKey = this.songPricingService.resolveCurrencyKey(
      platform,
      pricingData.currencyConfigs,
      [pricingData.defaultPrices],
    );
    const legacyDefaultPrice =
      settings.defaultPrice ??
      (currencyKey && pricingData.defaultPrices
        ? (pricingData.defaultPrices[currencyKey] ?? null)
        : null);
    const legacyDifficulty =
      currencyKey && pricingData.difficultyPricesByCurrency?.[currencyKey]
        ? pricingData.difficultyPricesByCurrency[currencyKey]
        : pricingData.difficultyPrices;
    const currencyUnit = this.songPricingService.resolveCurrencyUnit(
      platform,
      pricingData.currencyConfigs,
      currencyKey,
    );

    return {
      channelId: settings.channelId,
      pricingEnabled: settings.pricingEnabled,
      defaultPrice: legacyDefaultPrice,
      defaultPrices: pricingData.defaultPrices,
      difficultyPrices: legacyDifficulty,
      difficultyPricesByCurrency: pricingData.difficultyPricesByCurrency,
      currencyUnit,
      currencyConfigs: pricingData.currencyConfigs,
    };
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelOwnershipGuard)
  @Patch('songs/:songId/price')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '곡 가격 업데이트',
    description: '특정 곡의 가격을 업데이트합니다. 채널 소유자만 가능합니다.',
  })
  @ApiParam({ name: 'channelId', type: Number, description: '채널 ID' })
  @ApiParam({ name: 'songId', type: Number, description: '곡 ID' })
  @ApiResponse({
    status: 200,
    description: '곡 가격 업데이트 성공',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        price: { type: 'number', nullable: true },
        currencyPrices: { type: 'object', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '곡을 찾을 수 없음' })
  async updateSongPrice(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('songId', ParseIntPipe) songId: number,
    @Body() dto: UpdateSongPriceDto,
  ): Promise<{
    id: number;
    price: number | null;
    currencyPrices: CurrencyPriceMap | null;
  }> {
    // 곡이 해당 채널에 속하는지 확인
    const song = await this.prisma.song.findFirst({
      where: { id: songId, channelId },
      select: { id: true },
    });

    if (!song) {
      throw new NotFoundException('해당 채널에서 곡을 찾을 수 없습니다.');
    }

    if (dto.price === undefined && dto.currencyPrices === undefined) {
      throw new BadRequestException(
        'price 또는 currencyPrices 중 하나는 필요합니다.',
      );
    }

    const result = await this.songPricingService.updateSongPrice(
      songId,
      dto.price,
      dto.currencyPrices,
    );
    // 가격 변경은 song list 응답의 price/currencyPrices 영향 — channel SET 통째 회수.
    await this.cacheTracker.clearChannelSafe(channelId, 'updateSongPrice');
    return result;
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'), ChannelOwnershipGuard)
  @Patch('categories/:categoryId/price')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '카테고리 가격 업데이트',
    description:
      '특정 카테고리의 가격을 업데이트합니다. 채널 소유자만 가능합니다.',
  })
  @ApiParam({ name: 'channelId', type: Number, description: '채널 ID' })
  @ApiParam({ name: 'categoryId', type: Number, description: '카테고리 ID' })
  @ApiResponse({
    status: 200,
    description: '카테고리 가격 업데이트 성공',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        price: { type: 'number', nullable: true },
        currencyPrices: { type: 'object', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '채널 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '카테고리를 찾을 수 없음' })
  async updateCategoryPrice(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Body() dto: UpdateCategoryPriceDto,
  ): Promise<{
    id: number;
    price: number | null;
    currencyPrices: CurrencyPriceMap | null;
  }> {
    // 카테고리가 해당 채널에 속하는지 확인
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, channelId },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException('해당 채널에서 카테고리를 찾을 수 없습니다.');
    }

    if (dto.price === undefined && dto.currencyPrices === undefined) {
      throw new BadRequestException(
        'price 또는 currencyPrices 중 하나는 필요합니다.',
      );
    }

    const result = await this.songPricingService.updateCategoryPrice(
      categoryId,
      dto.price,
      dto.currencyPrices,
    );
    // 카테고리 가격 변경은 song list 응답의 categories[].price 영향
    await this.cacheTracker.clearChannelSafe(channelId, 'updateCategoryPrice');
    return result;
  }

  @Get('songs/:songId/price')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '곡 가격 조회',
    description: '특정 곡의 계산된 가격을 조회합니다.',
  })
  @ApiParam({ name: 'channelId', type: Number, description: '채널 ID' })
  @ApiParam({ name: 'songId', type: Number, description: '곡 ID' })
  @ApiResponse({
    status: 200,
    description: '곡 가격 조회 성공',
    type: CalculatedPriceResponseDto,
  })
  async getSongPrice(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('songId', ParseIntPipe) songId: number,
  ): Promise<CalculatedPriceResponseDto> {
    const result = await this.songPricingService.calculatePrice(
      songId,
      channelId,
    );

    return {
      songId,
      price: result.price,
      source: result.source,
      currencyUnit: result.currencyUnit,
      formattedPrice: result.formattedPrice,
    };
  }

  @Post('songs/calculate-prices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '여러 곡 가격 일괄 계산',
    description: '여러 곡의 가격을 한 번에 계산합니다.',
  })
  @ApiParam({ name: 'channelId', type: Number, description: '채널 ID' })
  @ApiResponse({
    status: 200,
    description: '가격 계산 성공',
    type: CalculatedPriceResponseDto,
    isArray: true,
  })
  async calculatePrices(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() dto: CalculatePricesDto,
  ): Promise<CalculatedPriceResponseDto[]> {
    const resultMap = await this.songPricingService.calculatePricesForSongs(
      dto.songIds,
      channelId,
    );

    return dto.songIds.map((songId) => {
      const result = resultMap.get(songId);
      return {
        songId,
        price: result?.price ?? null,
        source: result?.source ?? 'FREE',
        currencyUnit: result?.currencyUnit ?? '',
        formattedPrice: result?.formattedPrice ?? '',
      };
    });
  }

  /**
   * 채널의 플랫폼을 조회합니다.
   */
  private async getChannelPlatform(channelId: number) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        verifications: {
          select: { platform: true },
          where: { status: ChannelVerificationStatus.APPROVED },
          take: 1,
        },
      },
    });
    return channel?.verifications?.[0]?.platform;
  }
}
