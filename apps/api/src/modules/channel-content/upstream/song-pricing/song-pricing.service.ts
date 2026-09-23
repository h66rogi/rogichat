import { Injectable } from '@nestjs/common';
import {
  PriceSource,
  Prisma,
} from '../../../../generated/prisma/client.js';
import type { ChannelPricingSettings } from '../../../../generated/prisma/client.js';
import { nextChannelContentId } from '../../channel-content-id.js';
import { StreamPlatform } from './types/pricing.types.js';
import type { StreamPlatform as StreamPlatformType } from './types/pricing.types.js';
import type { CalculatedPriceResult, CurrencyConfig, CurrencyPriceMap, DifficultyPrices,
  DifficultyPricesByCurrency, SongForPricing } from './types/pricing.types.js';
import {
  buildStoredDifficultyPrices,
  extractStoredPricingData,
  formatPriceByCurrencyKey,
  getPrimaryCurrencyUnit,
  resolvePricingCurrencyKey,
  sanitizeCurrencyConfigs,
  sanitizeCurrencyPriceMap,
  sanitizeDifficultyPricesByCurrency,
} from './utils/currency-unit.util.js';

@Injectable()
export class SongPricingService {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  /**
   * 단일 곡의 가격을 계산합니다.
   */
  async calculatePrice(
    songId: number,
    channelId: string,
  ): Promise<CalculatedPriceResult> {
    const settings = await this.getPricingSettings(channelId);

    if (!settings?.pricingEnabled) {
      const platform = await this.getChannelPlatform(channelId);
      const pricingData = settings
        ? this.extractPricingData(settings)
        : {
            difficultyPrices: null,
            difficultyPricesByCurrency: null,
            defaultPrices: null,
            currencyConfigs: [],
          };
      return this.createFreeResult(platform, pricingData.currencyConfigs);
    }

    const song = await this.prisma.song.findUnique({
      where: { id: songId },
      select: {
        id: true,
        price: true,
        currencyPrices: true,
        difficulty: true,
        songCategories: {
          select: {
            category: {
              select: {
                id: true,
                price: true,
                currencyPrices: true,
              },
            },
          },
        },
      },
    });

    if (!song) {
      const platform = await this.getChannelPlatform(channelId);
      const pricingData = this.extractPricingData(settings);
      return this.createFreeResult(platform, pricingData.currencyConfigs);
    }

    const platform = await this.getChannelPlatform(channelId);
    return this.calculatePriceForSong(song, settings, platform);
  }

  /**
   * 여러 곡의 가격을 한 번에 계산합니다.
   * N+1 문제를 방지하기 위해 배치로 조회합니다.
   */
  async calculatePricesForSongs(
    songIds: number[],
    channelId: string,
  ): Promise<Map<number, CalculatedPriceResult>> {
    const resultMap = new Map<number, CalculatedPriceResult>();

    if (songIds.length === 0) {
      return resultMap;
    }

    const settings = await this.getPricingSettings(channelId);
    const platform = await this.getChannelPlatform(channelId);

    if (!settings?.pricingEnabled) {
      const freeResult = this.createFreeResult(platform);
      for (const songId of songIds) {
        resultMap.set(songId, freeResult);
      }
      return resultMap;
    }

    const songs = await this.prisma.song.findMany({
      where: { id: { in: songIds } },
      select: {
        id: true,
        price: true,
        currencyPrices: true,
        difficulty: true,
        songCategories: {
          select: {
            category: {
              select: {
                id: true,
                price: true,
                currencyPrices: true,
              },
            },
          },
        },
      },
    });

    const songMap = new Map(songs.map((s) => [s.id, s]));

    for (const songId of songIds) {
      const song = songMap.get(songId);
      if (song) {
        resultMap.set(
          songId,
          this.calculatePriceForSong(song, settings, platform),
        );
      } else {
        resultMap.set(songId, this.createFreeResult(platform));
      }
    }

    return resultMap;
  }

  /**
   * 채널의 가격 설정을 조회합니다.
   */
  async getPricingSettings(
    channelId: string,
  ): Promise<ChannelPricingSettings | null> {
    return this.prisma.channelPricingSettings.findUnique({
      where: { channelId },
    });
  }

  /**
   * 채널의 가격 설정을 업데이트합니다 (없으면 생성).
   */
  async updatePricingSettings(
    channelId: string,
    data: {
      pricingEnabled?: boolean;
      defaultPrice?: number | null;
      defaultPrices?: CurrencyPriceMap | null;
      difficultyPrices?: DifficultyPrices | null;
      difficultyPricesByCurrency?: DifficultyPricesByCurrency | null;
      currencyConfigs?: Array<{
        key: string;
        unit: string;
        amount?: number | null;
      }> | null;
    },
  ): Promise<ChannelPricingSettings> {
    const existing = await this.prisma.channelPricingSettings.findUnique({
      where: { channelId },
      select: { difficultyPrices: true },
    });

    const existingPricingData = this.extractPricingData(existing);

    const nextCurrencyConfigs =
      data.currencyConfigs !== undefined
        ? sanitizeCurrencyConfigs(data.currencyConfigs ?? [])
        : existingPricingData.currencyConfigs;

    let nextDefaultPrices: CurrencyPriceMap | null =
      data.defaultPrices !== undefined
        ? (sanitizeCurrencyPriceMap(data.defaultPrices) ?? null)
        : existingPricingData.defaultPrices;

    let nextDifficultyByCurrency: DifficultyPricesByCurrency | null =
      data.difficultyPricesByCurrency !== undefined
        ? (sanitizeDifficultyPricesByCurrency(
            data.difficultyPricesByCurrency,
          ) ?? null)
        : existingPricingData.difficultyPricesByCurrency;

    const nextDifficultyPrices =
      data.difficultyPrices !== undefined
        ? data.difficultyPrices
        : existingPricingData.difficultyPrices;

    // 구버전 payload(defaultPrice/difficultyPrices)를 재화별 맵으로 승격
    if (data.defaultPrice !== undefined) {
      nextDefaultPrices = this.applyLegacyPriceToMap(
        nextDefaultPrices,
        data.defaultPrice,
        nextCurrencyConfigs,
      );
    }
    if (data.difficultyPrices !== undefined) {
      nextDifficultyByCurrency = this.applyLegacyDifficultyToMap(
        nextDifficultyByCurrency,
        data.difficultyPrices,
        nextCurrencyConfigs,
      );
    }

    const difficultyPricesJson = buildStoredDifficultyPrices({
      difficultyPrices: nextDifficultyPrices,
      difficultyPricesByCurrency: nextDifficultyByCurrency,
      defaultPrices: nextDefaultPrices,
      currencyConfigs: nextCurrencyConfigs,
    }) as Prisma.InputJsonValue | null;

    // DB의 legacy default_price는 대표 재화 값을 유지
    const nextLegacyDefaultPrice = this.resolveLegacyDefaultPrice(
      nextDefaultPrices,
      nextCurrencyConfigs,
      data.defaultPrice,
    );

    return this.prisma.channelPricingSettings.upsert({
      where: { channelId },
      create: {
        id: await nextChannelContentId(this.prisma),
        channelId,
        pricingEnabled: data.pricingEnabled ?? false,
        defaultPrice: nextLegacyDefaultPrice,
        difficultyPrices: difficultyPricesJson ?? Prisma.DbNull,
      },
      update: {
        ...(data.pricingEnabled !== undefined && {
          pricingEnabled: data.pricingEnabled,
        }),
        ...((data.defaultPrice !== undefined ||
          data.defaultPrices !== undefined ||
          data.currencyConfigs !== undefined) && {
          defaultPrice: nextLegacyDefaultPrice,
        }),
        ...((data.difficultyPrices !== undefined ||
          data.difficultyPricesByCurrency !== undefined ||
          data.defaultPrices !== undefined ||
          data.currencyConfigs !== undefined) && {
          difficultyPrices: difficultyPricesJson ?? Prisma.DbNull,
        }),
      },
    });
  }

  /**
   * 저장된 pricing JSON에서 난이도 가격/재화 설정을 분리합니다.
   */
  extractPricingData(
    settings:
      | Pick<ChannelPricingSettings, 'difficultyPrices'>
      | { difficultyPrices: unknown }
      | null
      | undefined,
  ): {
    difficultyPrices: DifficultyPrices | null;
    difficultyPricesByCurrency: DifficultyPricesByCurrency | null;
    defaultPrices: CurrencyPriceMap | null;
    currencyConfigs: CurrencyConfig[];
  } {
    return extractStoredPricingData(settings?.difficultyPrices);
  }

  /**
   * 하위 호환용 단일 재화 단위를 반환합니다.
   */
  resolveCurrencyUnit(
    platform: StreamPlatformType | undefined | null,
    currencyConfigs?: CurrencyConfig[] | null,
    currencyKey?: string | null,
  ): string {
    return getPrimaryCurrencyUnit(platform, currencyConfigs, currencyKey);
  }

  resolveCurrencyKey(
    platform: StreamPlatformType | undefined | null,
    currencyConfigs?: CurrencyConfig[] | null,
    priceMaps?: Array<CurrencyPriceMap | null | undefined>,
  ): string | null {
    return resolvePricingCurrencyKey(platform, currencyConfigs, priceMaps);
  }

  /**
   * 계산된 가격 스냅샷을 재화 설정 기준으로 포맷합니다.
   */
  formatCalculatedPrice(
    calculatedPrice: number | null | undefined,
    platform: StreamPlatformType | undefined | null,
    currencyConfigs?: CurrencyConfig[] | null,
    currencyKey?: string | null,
  ): string {
    if (calculatedPrice == null) {
      return '무료';
    }

    const resolvedKey =
      currencyKey ?? this.resolveCurrencyKey(platform, currencyConfigs);

    return formatPriceByCurrencyKey(
      calculatedPrice,
      resolvedKey,
      currencyConfigs,
      platform,
    );
  }

  /**
   * 곡의 가격을 업데이트합니다.
   */
  async updateSongPrice(
    songId: number,
    price?: number | null,
    currencyPrices?: CurrencyPriceMap | null,
  ): Promise<{
    id: number;
    price: number | null;
    currencyPrices: CurrencyPriceMap | null;
  }> {
    const updateData: Prisma.SongUpdateInput = {};
    if (price !== undefined) {
      updateData.price = price;
    }
    if (currencyPrices !== undefined) {
      updateData.currencyPrices = (sanitizeCurrencyPriceMap(currencyPrices) as Prisma.InputJsonValue | null) ?? Prisma.DbNull;
    }

    return this.prisma.song.update({
      where: { id: songId },
      data: updateData,
      select: { id: true, price: true, currencyPrices: true },
    }) as unknown as {
      id: number;
      price: number | null;
      currencyPrices: CurrencyPriceMap | null;
    };
  }

  /**
   * 카테고리의 가격을 업데이트합니다.
   */
  async updateCategoryPrice(
    categoryId: number,
    price?: number | null,
    currencyPrices?: CurrencyPriceMap | null,
  ): Promise<{
    id: number;
    price: number | null;
    currencyPrices: CurrencyPriceMap | null;
  }> {
    const updateData: Prisma.CategoryUpdateInput = {};
    if (price !== undefined) {
      updateData.price = price;
    }
    if (currencyPrices !== undefined) {
      updateData.currencyPrices = (sanitizeCurrencyPriceMap(currencyPrices) as Prisma.InputJsonValue | null) ?? Prisma.DbNull;
    }

    return this.prisma.category.update({
      where: { id: categoryId },
      data: updateData,
      select: { id: true, price: true, currencyPrices: true },
    }) as unknown as {
      id: number;
      price: number | null;
      currencyPrices: CurrencyPriceMap | null;
    };
  }

  /**
   * 곡의 가격을 계산하는 내부 메서드입니다.
   *
   * 우선순위:
   * 1. 곡 자체 가격 (SONG)
   * 2. 난이도/카테고리 중 더 높은 가격 (DIFFICULTY/CATEGORY)
   * 3. 기본 가격 (DEFAULT)
   * 4. 무료 (FREE)
   */
  private calculatePriceForSong(
    song: SongForPricing,
    settings: ChannelPricingSettings,
    platform: StreamPlatformType | undefined,
  ): CalculatedPriceResult {
    const pricingData = this.extractPricingData(settings);
    const categoryPriceMaps = song.songCategories.map((sc) =>
      sanitizeCurrencyPriceMap(sc.category.currencyPrices),
    );
    const currencyKey = this.resolveCurrencyKey(
      platform,
      pricingData.currencyConfigs,
      [
        sanitizeCurrencyPriceMap(song.currencyPrices),
        ...categoryPriceMaps,
        pricingData.defaultPrices,
      ],
    );
    const currencyUnit = this.resolveCurrencyUnit(
      platform,
      pricingData.currencyConfigs,
      currencyKey,
    );

    const songPrice = this.getPriceByCurrencyOrLegacy(
      sanitizeCurrencyPriceMap(song.currencyPrices),
      currencyKey,
      song.price,
    );
    if (songPrice != null) {
      return this.createResult(
        songPrice,
        PriceSource.SONG,
        currencyKey,
        currencyUnit,
        platform,
        pricingData.currencyConfigs,
      );
    }

    const difficultyPrice = this.getDifficultyPrice(
      song.difficulty,
      currencyKey,
      pricingData.difficultyPrices,
      pricingData.difficultyPricesByCurrency,
    );
    const categoryPrice = this.getMaxCategoryPrice(
      song.songCategories.map((sc) => ({
        id: sc.category.id,
        price: sc.category.price,
        currencyPrices: sanitizeCurrencyPriceMap(sc.category.currencyPrices),
      })),
      currencyKey,
    );

    if (difficultyPrice != null || categoryPrice != null) {
      if (difficultyPrice != null && categoryPrice != null) {
        if (difficultyPrice >= categoryPrice) {
          return this.createResult(
            difficultyPrice,
            PriceSource.DIFFICULTY,
            currencyKey,
            currencyUnit,
            platform,
            pricingData.currencyConfigs,
          );
        }
        return this.createResult(
          categoryPrice,
          PriceSource.CATEGORY,
          currencyKey,
          currencyUnit,
          platform,
          pricingData.currencyConfigs,
        );
      }

      if (difficultyPrice != null) {
        return this.createResult(
          difficultyPrice,
          PriceSource.DIFFICULTY,
          currencyKey,
          currencyUnit,
          platform,
          pricingData.currencyConfigs,
        );
      }

      return this.createResult(
        categoryPrice,
        PriceSource.CATEGORY,
        currencyKey,
        currencyUnit,
        platform,
        pricingData.currencyConfigs,
      );
    }

    const defaultPrice = this.getPriceByCurrencyOrLegacy(
      pricingData.defaultPrices,
      currencyKey,
      settings.defaultPrice,
    );
    if (defaultPrice != null) {
      return this.createResult(
        defaultPrice,
        PriceSource.DEFAULT,
        currencyKey,
        currencyUnit,
        platform,
        pricingData.currencyConfigs,
      );
    }

    return this.createFreeResult(
      platform,
      pricingData.currencyConfigs,
      currencyKey,
    );
  }

  private createResult(
    price: number | null,
    source: PriceSource,
    currencyKey: string | null,
    currencyUnit: string,
    platform: StreamPlatformType | undefined,
    currencyConfigs: CurrencyConfig[],
  ): CalculatedPriceResult {
    return {
      price,
      source,
      currencyKey,
      currencyUnit,
      formattedPrice: formatPriceByCurrencyKey(
        price,
        currencyKey,
        currencyConfigs,
        platform,
      ),
    };
  }

  private getPriceByCurrencyOrLegacy(
    map: CurrencyPriceMap | null | undefined,
    currencyKey: string | null,
    legacyPrice: number | null | undefined,
  ): number | null {
    if (
      currencyKey &&
      map &&
      Object.prototype.hasOwnProperty.call(map, currencyKey)
    ) {
      return map[currencyKey] ?? null;
    }
    return legacyPrice ?? null;
  }

  private getDifficultyPrice(
    difficulty: number | null,
    currencyKey: string | null,
    legacyPrices: DifficultyPrices | null,
    pricesByCurrency: DifficultyPricesByCurrency | null,
  ): number | null {
    if (difficulty == null) {
      return null;
    }

    const level = difficulty.toString() as keyof DifficultyPrices;

    if (currencyKey && pricesByCurrency?.[currencyKey]) {
      const byCurrency = pricesByCurrency[currencyKey];
      if (
        byCurrency &&
        Object.prototype.hasOwnProperty.call(byCurrency, level)
      ) {
        return byCurrency[level] ?? null;
      }
    }

    return legacyPrices?.[level] ?? null;
  }

  private getMaxCategoryPrice(
    categories: Array<{
      id: number;
      price: number | null;
      currencyPrices: CurrencyPriceMap | null;
    }>,
    currencyKey: string | null,
  ): number | null {
    if (categories.length === 0) {
      return null;
    }

    const prices = categories
      .map((category) =>
        this.getPriceByCurrencyOrLegacy(
          category.currencyPrices,
          currencyKey,
          category.price,
        ),
      )
      .filter((price): price is number => price != null);

    if (prices.length === 0) {
      return null;
    }

    return Math.max(...prices);
  }

  private resolveLegacyDefaultPrice(
    defaultPrices: CurrencyPriceMap | null,
    currencyConfigs: CurrencyConfig[],
    explicitLegacy: number | null | undefined,
  ): number | null {
    if (explicitLegacy !== undefined) {
      return explicitLegacy ?? null;
    }
    if (!defaultPrices) {
      return null;
    }

    const preferredKey = resolvePricingCurrencyKey(undefined, currencyConfigs, [
      defaultPrices,
    ]);
    if (
      preferredKey &&
      Object.prototype.hasOwnProperty.call(defaultPrices, preferredKey)
    ) {
      return defaultPrices[preferredKey] ?? null;
    }

    const firstKey = Object.keys(defaultPrices)[0];
    return firstKey ? (defaultPrices[firstKey] ?? null) : null;
  }

  private applyLegacyPriceToMap(
    baseMap: CurrencyPriceMap | null,
    legacyPrice: number | null | undefined,
    currencyConfigs: CurrencyConfig[],
  ): CurrencyPriceMap | null {
    if (legacyPrice === undefined) {
      return baseMap;
    }

    const next: CurrencyPriceMap = { ...(baseMap ?? {}) };
    const key = resolvePricingCurrencyKey(undefined, currencyConfigs, [
      baseMap,
    ]);
    if (!key) {
      return legacyPrice == null
        ? baseMap
        : { ...(baseMap ?? {}), KRW: legacyPrice };
    }
    next[key] = legacyPrice ?? null;
    return next;
  }

  private applyLegacyDifficultyToMap(
    baseMap: DifficultyPricesByCurrency | null,
    legacyDifficulty: DifficultyPrices | null | undefined,
    currencyConfigs: CurrencyConfig[],
  ): DifficultyPricesByCurrency | null {
    if (legacyDifficulty === undefined) {
      return baseMap;
    }

    const next: DifficultyPricesByCurrency = { ...(baseMap ?? {}) };
    const key = resolvePricingCurrencyKey(undefined, currencyConfigs, [
      null,
      this.pickAnyDifficultyMap(baseMap),
    ]);
    const targetKey = key ?? 'KRW';
    next[targetKey] = legacyDifficulty ?? null;
    return next;
  }

  private pickAnyDifficultyMap(
    map: DifficultyPricesByCurrency | null,
  ): CurrencyPriceMap | null {
    if (!map) {
      return null;
    }
    const firstKey = Object.keys(map)[0];
    if (!firstKey) {
      return null;
    }
    return { [firstKey]: 0 };
  }

  /**
   * 채널의 플랫폼을 조회합니다.
   */
  private async getChannelPlatform(
    channelId: string,
  ): Promise<StreamPlatformType | undefined> {
    const room = await this.prisma.rooms.findUnique({where:{id:channelId},select:{id:true}});
    return room ? StreamPlatform.SOOP : undefined;
  }

  /**
   * FREE 결과를 생성합니다.
   */
  private createFreeResult(
    platform: StreamPlatformType | undefined,
    currencyConfigs?: CurrencyConfig[] | null,
    currencyKey?: string | null,
  ): CalculatedPriceResult {
    const resolvedKey =
      currencyKey ?? this.resolveCurrencyKey(platform, currencyConfigs);
    return {
      price: null,
      source: PriceSource.FREE,
      currencyKey: resolvedKey,
      currencyUnit: this.resolveCurrencyUnit(
        platform,
        currencyConfigs,
        resolvedKey,
      ),
      formattedPrice: '',
    };
  }
}
