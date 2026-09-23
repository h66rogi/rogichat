import { CategoryDto, CategoryListItemDto } from '../dto/category.response.dto';
import type { CategoryWithCounts } from '../prisma/category.selections';
import { sanitizeCurrencyPriceMap } from '../../song-pricing/utils/currency-unit.util';

export function toCategoryListItemDto(
  category: CategoryWithCounts,
): CategoryListItemDto {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    channelId: category.channelId,
    price: category.price ?? null,
    currencyPrices: sanitizeCurrencyPriceMap(category.currencyPrices),
    displayOrder: category.displayOrder ?? null,
    createdAt: category.createdAt,
    songCount: category._count.songCategories,
    channel: category.channel,
  };
}

export function toCategoryDto(category: {
  id: number;
  name: string;
  color: string;
  channelId: number;
  price?: number | null;
  currencyPrices?: unknown;
  displayOrder?: number | null;
  createdAt: Date | null;
}): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    channelId: category.channelId,
    price: category.price ?? null,
    currencyPrices: sanitizeCurrencyPriceMap(category.currencyPrices),
    displayOrder: category.displayOrder ?? null,
    createdAt: category.createdAt,
  };
}
