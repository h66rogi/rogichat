import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelService } from '../channel/channel.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category.request.dto';
import {
  categoryListQuery,
  CategoryWithCounts,
} from './prisma/category.selections';
import { categoryCacheKeys } from './cache/category.cache-keys';
import {
  ResourceNotFoundException,
  InvalidInputException,
} from '../common/exceptions/custom.exception';
import {
  pickLegacyPrice,
  sanitizeCurrencyPriceMap,
} from '../song-pricing/utils/currency-unit.util';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';

const CATEGORY_PUBLIC_CACHE_TTL_SEC = 5;

type CategoryOrderRow = {
  id: number;
  name: string;
  color: string;
  channelId: number;
  price: number | null;
  currencyPrices: unknown;
  displayOrder: number | null;
  createdAt: Date | null;
};

@Injectable()
export class CategoryService {
  constructor(
    private prisma: PrismaService,
    private readonly channelService: ChannelService,
    private readonly cacheTracker: CacheKeyTrackingService,
  ) {}

  async getCategoriesByChannelId(
    channelId: number,
    options?: { useCache?: boolean },
  ): Promise<CategoryWithCounts[]> {
    const useCache = options?.useCache ?? false;
    const cacheKey = categoryCacheKeys.byChannel(channelId);

    if (useCache) {
      const cached =
        await this.cacheTracker.get<CategoryWithCounts[]>(cacheKey);
      if (Array.isArray(cached)) {
        return cached;
      }
    }

    const categoriesWithCount = await this.prisma.category.findMany({
      where: { channelId: channelId },
      ...categoryListQuery,
      orderBy: [
        { displayOrder: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
    });

    if (useCache) {
      await this.cacheTracker.trackAndSet(
        cacheKey,
        categoriesWithCount,
        CATEGORY_PUBLIC_CACHE_TTL_SEC,
        { kind: 'channel', channelId },
      );
    }

    return categoriesWithCount as CategoryWithCounts[];
  }

  async getCategoriesByUserId(userId: number) {
    const channelId = await this.channelService.getChannelIdByUserId(userId);

    const categories = await this.getCategoriesByChannelId(channelId);

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      channelId: category.channelId,
      price: category.price ?? null,
      currencyPrices: sanitizeCurrencyPriceMap(category.currencyPrices),
      displayOrder: category.displayOrder ?? null,
      userId: userId,
      createdAt: category.createdAt,
      songCount: category._count.songCategories,
    }));
  }

  async getCategoriesByWebPath(webPath: string): Promise<CategoryWithCounts[]> {
    const cacheKey = categoryCacheKeys.byWebPath(webPath);

    const cached = await this.cacheTracker.get<CategoryWithCounts[]>(cacheKey);
    if (Array.isArray(cached)) {
      return cached;
    }

    const channel = await this.channelService.findByWebPath(webPath);
    if (!channel) {
      throw new ResourceNotFoundException('음악북을 찾을 수 없습니다.');
    }

    const result = await this.getCategoriesByChannelId(channel.id);

    // webPath 키지만 channel scope 등록 — 채널 mutation 시 채널 SET 통째 회수.
    await this.cacheTracker.trackAndSet(
      cacheKey,
      result,
      CATEGORY_PUBLIC_CACHE_TTL_SEC,
      { kind: 'channel', channelId: channel.id },
    );

    return result;
  }

  async createCategoryByChannelId(
    createCategoryDto: CreateCategoryDto,
    channelId: number,
  ) {
    await this.assertUniqueCategoryNameInChannel(
      createCategoryDto.name,
      channelId,
    );

    const currencyPrices = sanitizeCurrencyPriceMap(
      createCategoryDto.currencyPrices,
    );
    const fallbackPrice = pickLegacyPrice(currencyPrices);

    const newCategory = await this.prisma.category.create({
      data: {
        name: createCategoryDto.name,
        color: createCategoryDto.color,
        displayOrder: createCategoryDto.displayOrder,
        price: createCategoryDto.price ?? fallbackPrice,
        currencyPrices: currencyPrices as any,
        channelId: channelId,
      },
    });

    await this.clearChannelCategoryCaches(channelId);

    return newCategory;
  }

  async createCategory(createCategoryDto: CreateCategoryDto, userId: number) {
    const channelId = await this.channelService.getChannelIdByUserId(userId);

    return this.createCategoryByChannelId(createCategoryDto, channelId);
  }

  async updateCategoryByChannelId(
    categoryId: number,
    updateCategoryDto: UpdateCategoryDto,
    channelId: number,
  ) {
    try {
      if (updateCategoryDto.name && updateCategoryDto.name.trim() !== '') {
        await this.assertUniqueCategoryNameInChannel(
          updateCategoryDto.name,
          channelId,
          categoryId,
        );
      }

      const currencyPrices =
        updateCategoryDto.currencyPrices !== undefined
          ? sanitizeCurrencyPriceMap(updateCategoryDto.currencyPrices)
          : undefined;
      const updateData: import('@prisma/client').Prisma.CategoryUpdateInput = {
        ...(updateCategoryDto.name !== undefined && {
          name: updateCategoryDto.name,
        }),
        ...(updateCategoryDto.color !== undefined && {
          color: updateCategoryDto.color,
        }),
        ...(updateCategoryDto.displayOrder !== undefined && {
          displayOrder: updateCategoryDto.displayOrder,
        }),
        ...(updateCategoryDto.price !== undefined && {
          price: updateCategoryDto.price,
        }),
        ...(updateCategoryDto.currencyPrices !== undefined && {
          currencyPrices: (currencyPrices ?? null) as any,
        }),
      };

      if (
        updateCategoryDto.currencyPrices !== undefined &&
        updateCategoryDto.price === undefined
      ) {
        updateData.price = pickLegacyPrice(currencyPrices);
      }

      const updatedCategory = await this.prisma.category.update({
        where: {
          id: categoryId,
          channelId: channelId,
        },
        data: updateData,
      });

      await this.clearChannelCategoryCaches(channelId);

      return updatedCategory;
    } catch {
      throw new ResourceNotFoundException(
        '카테고리를 찾을 수 없거나 수정 권한이 없습니다.',
      );
    }
  }

  async updateCategory(
    categoryId: number,
    updateCategoryDto: UpdateCategoryDto,
    userId: number,
  ) {
    const channelId = await this.channelService.getChannelIdByUserId(userId);

    return this.updateCategoryByChannelId(
      categoryId,
      updateCategoryDto,
      channelId,
    );
  }

  async deleteCategoryByChannelId(categoryId: number, channelId: number) {
    try {
      await this.prisma.category.delete({
        where: {
          id: categoryId,
          channelId: channelId,
        },
      });

      await this.clearChannelCategoryCaches(channelId);

      return { message: '카테고리가 삭제되었습니다.' };
    } catch {
      throw new ResourceNotFoundException(
        '카테고리를 찾을 수 없거나 삭제 권한이 없습니다.',
      );
    }
  }

  async deleteCategory(categoryId: number, userId: number) {
    const channelId = await this.channelService.getChannelIdByUserId(userId);

    return this.deleteCategoryByChannelId(categoryId, channelId);
  }

  async swapCategoryOrderByChannelId(
    categoryId: number,
    targetCategoryId: number,
    channelId: number,
  ) {
    if (categoryId === targetCategoryId) {
      throw new InvalidInputException(
        '서로 다른 카테고리끼리만 순서를 변경할 수 있습니다.',
      );
    }

    const swappedCategories = await this.prisma.$transaction(async (tx) => {
      const categories = await tx.category.findMany({
        where: { channelId },
        select: {
          id: true,
          name: true,
          color: true,
          channelId: true,
          price: true,
          currencyPrices: true,
          displayOrder: true,
          createdAt: true,
        },
      });

      const categoryMap = new Map(
        categories.map((category) => [category.id, category]),
      );
      const sourceCategory = categoryMap.get(categoryId);
      const targetCategory = categoryMap.get(targetCategoryId);

      if (!sourceCategory || !targetCategory) {
        throw new ResourceNotFoundException(
          '카테고리를 찾을 수 없거나 수정 권한이 없습니다.',
        );
      }

      const needsNormalization = this.hasInvalidDisplayOrders(categories);
      const normalizedCategories = needsNormalization
        ? this.normalizeCategoryOrders(categories)
        : categories;

      if (needsNormalization) {
        await Promise.all(
          normalizedCategories.map((category) =>
            tx.category.update({
              where: { id: category.id, channelId },
              data: { displayOrder: category.displayOrder },
            }),
          ),
        );
      }

      const normalizedCategoryMap = new Map(
        normalizedCategories.map((category) => [category.id, category]),
      );
      const normalizedSource = normalizedCategoryMap.get(categoryId);
      const normalizedTarget = normalizedCategoryMap.get(targetCategoryId);

      if (
        !normalizedSource ||
        !normalizedTarget ||
        normalizedSource.displayOrder == null ||
        normalizedTarget.displayOrder == null
      ) {
        throw new InvalidInputException(
          '카테고리 순서를 정규화할 수 없어 교환에 실패했습니다.',
        );
      }

      await Promise.all([
        tx.category.update({
          where: { id: normalizedSource.id, channelId },
          data: { displayOrder: normalizedTarget.displayOrder },
        }),
        tx.category.update({
          where: { id: normalizedTarget.id, channelId },
          data: { displayOrder: normalizedSource.displayOrder },
        }),
      ]);

      const updatedCategories = await tx.category.findMany({
        where: {
          channelId,
          id: { in: [normalizedSource.id, normalizedTarget.id] },
        },
      });

      return [normalizedSource.id, normalizedTarget.id]
        .map((id) => updatedCategories.find((category) => category.id === id))
        .filter((category): category is (typeof updatedCategories)[number] =>
          Boolean(category),
        );
    });

    await this.clearChannelCategoryCaches(channelId);

    return swappedCategories;
  }

  /**
   * 채널 SET 통째 회수 — category/song 캐시 모두 atomic 무효화.
   * Layer 1 도입 후 category mutation 시 song list 응답도 즉시 stale 해소.
   */
  private async clearChannelCategoryCaches(channelId: number) {
    await this.cacheTracker.clearChannel(channelId);
  }

  private async assertUniqueCategoryNameInChannel(
    name: string,
    channelId: number,
    excludeCategoryId?: number,
  ): Promise<void> {
    const trimmedName = name?.trim();
    if (!trimmedName) return;

    const dup = (
      await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id
      FROM categories
      WHERE channel_id = ${channelId}
        AND REPLACE(LOWER(name), ' ', '') = REPLACE(LOWER(${trimmedName}), ' ', '')
      LIMIT 1
    `
    )[0];

    if (dup && (!excludeCategoryId || dup.id !== excludeCategoryId)) {
      throw new InvalidInputException('이미 존재하는 카테고리 이름입니다.');
    }
  }

  private hasInvalidDisplayOrders(categories: CategoryOrderRow[]): boolean {
    const seenOrders = new Set<number>();

    for (const category of categories) {
      if (category.displayOrder == null) {
        return true;
      }

      if (seenOrders.has(category.displayOrder)) {
        return true;
      }

      seenOrders.add(category.displayOrder);
    }

    return false;
  }

  private normalizeCategoryOrders(
    categories: CategoryOrderRow[],
  ): CategoryOrderRow[] {
    const sortedCategories = [...categories].sort((a, b) => {
      const orderA = a.displayOrder ?? Number.NEGATIVE_INFINITY;
      const orderB = b.displayOrder ?? Number.NEGATIVE_INFINITY;

      if (orderA !== orderB) {
        return orderB - orderA;
      }

      const nameCompare = a.name.localeCompare(b.name, 'ko');
      if (nameCompare !== 0) {
        return nameCompare;
      }

      const createdAtA = a.createdAt?.getTime() ?? 0;
      const createdAtB = b.createdAt?.getTime() ?? 0;
      if (createdAtA !== createdAtB) {
        return createdAtA - createdAtB;
      }

      return a.id - b.id;
    });

    return sortedCategories.map((category, index) => ({
      ...category,
      displayOrder: (sortedCategories.length - index) * 10,
    }));
  }
}
