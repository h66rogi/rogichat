import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import type { CreateChannelWardrobeCategoryDto, CreateChannelWardrobeItemDto, UpdateChannelWardrobeCategoryDto, UpdateChannelWardrobeItemDto } from './upstream/channel-wardrobe.dto.js';

const ratios = ['16:9','9:16','1:1','4:3','3:4'];
function body(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST',400);
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new ApiError('INVALID_REQUEST',400);
  return data;
}
function text(data: Record<string,unknown>, key: string, max: number, required = false): void {
  const value = data[key];
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || value.trim().length < (required ? 1 : 0) || value.length > max) throw new ApiError('INVALID_REQUEST',400);
}
function categoryInput(value: unknown, create: boolean) {
  const data = body(value,create ? ['name','defaultAspectRatio'] : ['name','defaultAspectRatio','isEnabled','order']);
  text(data,'name',40,create);
  if (data.defaultAspectRatio !== undefined && !ratios.includes(String(data.defaultAspectRatio))) throw new ApiError('INVALID_REQUEST',400);
  if (data.isEnabled !== undefined && typeof data.isEnabled !== 'boolean') throw new ApiError('INVALID_REQUEST',400);
  if (data.order !== undefined && (!Number.isSafeInteger(data.order) || Number(data.order) < 0)) throw new ApiError('INVALID_REQUEST',400);
  return data;
}
function itemInput(value: unknown, create: boolean) {
  const data = body(value,create ? ['title','imageUrl','categoryId','description','tags'] : ['title','imageUrl','categoryId','description','tags','isVisible','order']);
  text(data,'title',40,create); text(data,'imageUrl',2048,create);
  if (data.description !== undefined && (typeof data.description !== 'string' || data.description.length > 5000)) throw new ApiError('INVALID_REQUEST',400);
  if (data.categoryId !== undefined && (!Number.isSafeInteger(data.categoryId) || Number(data.categoryId) < 1)) throw new ApiError('INVALID_REQUEST',400);
  if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.length > 12 || data.tags.some(tag => typeof tag !== 'string' || tag.length > 24))) throw new ApiError('INVALID_REQUEST',400);
  if (data.isVisible !== undefined && typeof data.isVisible !== 'boolean') throw new ApiError('INVALID_REQUEST',400);
  if (data.order !== undefined && (!Number.isSafeInteger(data.order) || Number(data.order) < 0)) throw new ApiError('INVALID_REQUEST',400);
  return data;
}

/** Meloming's complete wardrobe service runs against Rogichat's transaction client. */
@Injectable()
export class WardrobeService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  public() {
    return this.transactions.write(async tx => {
      // Meloming lazily creates 의상/헤어 on first read. Serialize that upsert.
      await this.repository.lockPrimary(tx);
      const { roomId } = await this.repository.primary(tx);
      return this.repository.wardrobe(tx).getPublicWardrobe(roomId);
    });
  }
  manage(credentials: SessionCredentials) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      return this.repository.wardrobe(tx).getManageWardrobe(roomId);
    });
  }
  createCategory(credentials: CommandCredentials, value: unknown) {
    const data = categoryInput(value,true) as unknown as CreateChannelWardrobeCategoryDto;
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      return this.repository.wardrobe(tx).createCategory(roomId,data);
    });
  }
  updateCategory(credentials: CommandCredentials, id: number, value: unknown) {
    const data = categoryInput(value,false) as unknown as UpdateChannelWardrobeCategoryDto;
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      return this.repository.wardrobe(tx).updateCategory(roomId,id,data);
    });
  }
  deleteCategory(credentials: CommandCredentials, id: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      return this.repository.wardrobe(tx).deleteCategory(roomId,id);
    });
  }
  createItem(credentials: CommandCredentials, value: unknown) {
    const data = itemInput(value,true) as unknown as CreateChannelWardrobeItemDto;
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      return this.repository.wardrobe(tx).createItem(roomId,data);
    });
  }
  updateItem(credentials: CommandCredentials, id: number, value: unknown) {
    const data = itemInput(value,false) as unknown as UpdateChannelWardrobeItemDto;
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      return this.repository.wardrobe(tx).updateItem(roomId,id,data);
    });
  }
  deleteItem(credentials: CommandCredentials, id: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      return this.repository.wardrobe(tx).deleteItem(roomId,id);
    });
  }
}
