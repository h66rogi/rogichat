import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { CategoryService } from './upstream/category.service.js';
import type { CreateCategoryDto, UpdateCategoryDto } from './upstream/category.service.js';
import { sanitizeCurrencyPriceMap } from './upstream/currency-price.util.js';

function categoryInput(value: unknown, create: boolean): CreateCategoryDto | UpdateCategoryDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['name', 'color', 'displayOrder', 'price', 'currencyPrices'].includes(key)) ||
      (create && (typeof data.name !== 'string' || typeof data.color !== 'string'))) throw new ApiError('INVALID_REQUEST', 400);
  if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 255)) throw new ApiError('INVALID_REQUEST', 400);
  if (data.color !== undefined && (typeof data.color !== 'string' || !data.color.trim() || data.color.length > 32)) throw new ApiError('INVALID_REQUEST', 400);
  for (const key of ['displayOrder', 'price']) if (data[key] !== undefined && data[key] !== null &&
      (!Number.isSafeInteger(data[key]) || Number(data[key]) < 0)) throw new ApiError('INVALID_REQUEST', 400);
  if (data.currencyPrices !== undefined && data.currencyPrices !== null &&
      (typeof data.currencyPrices !== 'object' || Array.isArray(data.currencyPrices) ||
       Object.keys(data.currencyPrices).length > 20 ||
       Object.entries(data.currencyPrices).some(([key, amount]) => key.length > 64 ||
         (amount !== null && (!Number.isSafeInteger(amount) || Number(amount) < 0))))) throw new ApiError('INVALID_REQUEST', 400);
  return data as CreateCategoryDto | UpdateCategoryDto;
}

function categoryDto(row: { id: number; name: string; color: string; price: number | null; currencyPrices: unknown;
    displayOrder: number | null; createdAt: Date | null }) {
  // Field selection is copied from Meloming's toCategoryDto mapper; only the
  // internal Channel key is replaced with its stable public integer alias.
  return { id: row.id, name: row.name, color: row.color, channelId: 1,
    price: row.price ?? null, currencyPrices: sanitizeCurrencyPriceMap(row.currencyPrices),
    displayOrder: row.displayOrder ?? null, createdAt: row.createdAt };
}

@Injectable()
export class MelomingCategoryService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  create(credentials: CommandCredentials, value: unknown) {
    const dto = categoryInput(value, true) as CreateCategoryDto;
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return categoryDto(await new CategoryService(tx.prisma).createCategoryByChannelId(dto, roomId));
    });
  }

  update(credentials: CommandCredentials, id: number, value: unknown) {
    const dto = categoryInput(value, false) as UpdateCategoryDto;
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return categoryDto(await new CategoryService(tx.prisma).updateCategoryByChannelId(id, dto, roomId));
    });
  }

  remove(credentials: CommandCredentials, id: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return new CategoryService(tx.prisma).deleteCategoryByChannelId(id, roomId);
    });
  }

  swap(credentials: CommandCredentials, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'categoryId,targetCategoryId') throw new ApiError('INVALID_REQUEST', 400);
    const data = value as Record<string, unknown>;
    const source = data.categoryId, target = data.targetCategoryId;
    if (!Number.isSafeInteger(source) || Number(source) < 1 || !Number.isSafeInteger(target) || Number(target) < 1) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return (await new CategoryService(tx.prisma).swapCategoryOrderByChannelId(Number(source), Number(target), roomId)).map(categoryDto);
    });
  }
}
