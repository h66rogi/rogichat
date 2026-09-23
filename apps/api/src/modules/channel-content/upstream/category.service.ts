// Adapted by copying the relevant methods from meloming-back a91393b2
// src/category/category.service.ts. Channel int is a room UUID here.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { nextChannelContentId } from '../channel-content-id.js';
import { pickLegacyPrice, sanitizeCurrencyPriceMap } from './currency-price.util.js';

export interface CreateCategoryDto { name: string; color: string; displayOrder?: number; price?: number | null; currencyPrices?: Record<string, number | null> | null }
export type UpdateCategoryDto = Partial<CreateCategoryDto>;
type CategoryOrderRow = { id: number; name: string; color: string; channelId: string; price: number | null; currencyPrices: unknown; displayOrder: number | null; createdAt: Date | null };

export class CategoryService {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async createCategoryByChannelId(
    createCategoryDto: CreateCategoryDto,
    channelId: string,
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
        id: await nextChannelContentId(this.prisma),
        name: createCategoryDto.name,
        color: createCategoryDto.color,
        ...(createCategoryDto.displayOrder !== undefined ? { displayOrder: createCategoryDto.displayOrder } : {}),
        price: createCategoryDto.price ?? fallbackPrice,
        currencyPrices: currencyPrices ?? Prisma.DbNull,
        channelId: channelId,
      },
    });

    return newCategory;
  }


  async updateCategoryByChannelId(
    categoryId: number,
    updateCategoryDto: UpdateCategoryDto,
    channelId: string,
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
      const updateData: Prisma.CategoryUpdateInput = {
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
          currencyPrices: currencyPrices ?? Prisma.DbNull,
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

      return updatedCategory;
    } catch {
      throw new NotFoundException(
        '카테고리를 찾을 수 없거나 수정 권한이 없습니다.',
      );
    }
  }


  async deleteCategoryByChannelId(categoryId: number, channelId: string) {
    try {
      // Meloming cascades song-category links; Rogichat's existing FK is
      // restrictive, so remove the same links inside the caller transaction.
      await this.prisma.songCategory.deleteMany({ where: { categoryId, category: { channelId } } });
      await this.prisma.category.delete({
        where: {
          id: categoryId,
          channelId: channelId,
        },
      });

      return { message: '카테고리가 삭제되었습니다.' };
    } catch {
      throw new NotFoundException(
        '카테고리를 찾을 수 없거나 삭제 권한이 없습니다.',
      );
    }
  }

  async swapCategoryOrderByChannelId(
    categoryId: number,
    targetCategoryId: number,
    channelId: string,
  ) {
    if (categoryId === targetCategoryId) {
      throw new BadRequestException(
        '서로 다른 카테고리끼리만 순서를 변경할 수 있습니다.',
      );
    }

    const swappedCategories = await (async () => {
      const tx = this.prisma;
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
        throw new NotFoundException(
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
        throw new BadRequestException(
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
    })();

    return swappedCategories;
  }


  private async assertUniqueCategoryNameInChannel(
    name: string,
    channelId: string,
    excludeCategoryId?: number,
  ): Promise<void> {
    const trimmedName = name?.trim();
    if (!trimmedName) return;

    // Prisma has no expression filter for Meloming's exact LOWER/REPLACE
    // duplicate rule. Parameters remain bound; the owner room is locked above.
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
      throw new BadRequestException('이미 존재하는 카테고리 이름입니다.');
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
