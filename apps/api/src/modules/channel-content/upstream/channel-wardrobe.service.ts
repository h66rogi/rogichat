// Adapted from meloming-back a91393b2 src/channel/channel-wardrobe.service.ts.
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { nextChannelContentId } from '../channel-content-id.js';
import { sanitizeSyncPostHtml } from './html-sanitizer.js';
import {
  CHANNEL_WARDROBE_ASPECT_RATIOS,
  CHANNEL_WARDROBE_DESCRIPTION_MAX_LENGTH,
  CHANNEL_WARDROBE_LABEL_MAX_LENGTH,
  CHANNEL_WARDROBE_MAX_CATEGORIES,
  CHANNEL_WARDROBE_MAX_ITEMS,
  CHANNEL_WARDROBE_TAG_MAX_COUNT,
  CHANNEL_WARDROBE_TAG_MAX_LENGTH,
  DEFAULT_CHANNEL_WARDROBE_ASPECT_RATIO,
  DEFAULT_CHANNEL_WARDROBE_CATEGORIES,
  type ChannelWardrobeAspectRatio,
} from './channel-wardrobe.constants.js';
import type {
  ChannelWardrobeCategoryDto,
  ChannelWardrobeItemDto,
  ChannelWardrobeResponseDto,
  CreateChannelWardrobeCategoryDto,
  CreateChannelWardrobeItemDto,
  UpdateChannelWardrobeCategoryDto,
  UpdateChannelWardrobeItemDto,
} from './channel-wardrobe.dto.js';

export class ChannelWardrobeService {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async getPublicWardrobe(channelId: string): Promise<ChannelWardrobeResponseDto> {
    await this.ensureDefaultCategories(channelId);

    const [categories, items] = await Promise.all([
      this.prisma.channelWardrobeCategory.findMany({
        where: { channelId, isEnabled: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.channelWardrobeItem.findMany({
        where: {
          channelId,
          isVisible: true,
          category: { isEnabled: true },
        },
        orderBy: [
          { category: { sortOrder: 'asc' } },
          { sortOrder: 'asc' },
          { id: 'asc' },
        ],
      }),
    ]);

    return {
      categories: categories.map((category) => this.toCategoryDto(category)),
      items: items.map((item) => this.toItemDto(item)),
    };
  }

  async getManageWardrobe(channelId: string): Promise<ChannelWardrobeResponseDto> {
    await this.ensureDefaultCategories(channelId);
    return this.getFullWardrobe(channelId);
  }

  async createCategory(
    channelId: string,
    dto: CreateChannelWardrobeCategoryDto,
  ): Promise<ChannelWardrobeResponseDto> {
    await this.ensureDefaultCategories(channelId);
    const categoryCount = await this.prisma.channelWardrobeCategory.count({
      where: { channelId },
    });
    if (categoryCount >= CHANNEL_WARDROBE_MAX_CATEGORIES) {
      throw new BadRequestException('옷장 분류는 최대 20개까지 만들 수 있습니다.');
    }

    const max = await this.prisma.channelWardrobeCategory.aggregate({
      where: { channelId },
      _max: { sortOrder: true },
    });

    await this.prisma.channelWardrobeCategory.create({
      data: {
        id: await nextChannelContentId(this.prisma),
        channelId,
        name: this.normalizeRequiredText(dto.name, '분류 이름'),
        defaultAspectRatio: this.normalizeAspectRatio(dto.defaultAspectRatio),
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });

    return this.getFullWardrobe(channelId);
  }

  async updateCategory(
    channelId: string,
    categoryId: number,
    dto: UpdateChannelWardrobeCategoryDto,
  ): Promise<ChannelWardrobeResponseDto> {
    await this.assertCategory(channelId, categoryId);

    await this.prisma.channelWardrobeCategory.update({
      where: { id: categoryId },
      data: {
        ...(dto.name !== undefined
          ? { name: this.normalizeRequiredText(dto.name, '분류 이름') }
          : {}),
        ...(dto.defaultAspectRatio !== undefined
          ? {
              defaultAspectRatio: this.normalizeAspectRatio(
                dto.defaultAspectRatio,
              ),
            }
          : {}),
        ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
        ...(dto.order !== undefined ? { sortOrder: dto.order } : {}),
      },
    });

    return this.getFullWardrobe(channelId);
  }

  async deleteCategory(
    channelId: string,
    categoryId: number,
  ): Promise<ChannelWardrobeResponseDto> {
    await this.assertCategory(channelId, categoryId);

    const [categoryCount, itemCount] = await Promise.all([
      this.prisma.channelWardrobeCategory.count({ where: { channelId } }),
      this.prisma.channelWardrobeItem.count({ where: { channelId, categoryId } }),
    ]);

    if (categoryCount <= 1) {
      throw new BadRequestException('옷장 분류는 최소 1개가 필요합니다.');
    }
    if (itemCount > 0) {
      throw new BadRequestException('분류에 포함된 항목을 먼저 이동하거나 삭제해주세요.');
    }

    await this.prisma.channelWardrobeCategory.delete({
      where: { id: categoryId },
    });

    return this.getFullWardrobe(channelId);
  }

  async createItem(
    channelId: string,
    dto: CreateChannelWardrobeItemDto,
  ): Promise<ChannelWardrobeResponseDto> {
    await this.ensureDefaultCategories(channelId);
    const category = await this.resolveCategory(channelId, dto.categoryId);
    const itemCount = await this.prisma.channelWardrobeItem.count({
      where: { channelId },
    });
    if (itemCount >= CHANNEL_WARDROBE_MAX_ITEMS) {
      throw new BadRequestException('옷장 항목은 최대 200개까지 만들 수 있습니다.');
    }

    const max = await this.prisma.channelWardrobeItem.aggregate({
      where: { channelId, categoryId: category.id },
      _max: { sortOrder: true },
    });

    await this.prisma.channelWardrobeItem.create({
      data: {
        id: await nextChannelContentId(this.prisma),
        channelId,
        categoryId: category.id,
        title: this.normalizeRequiredText(dto.title, '항목 이름'),
        imageUrl: this.normalizeImageUrl(dto.imageUrl),
        description: this.normalizeDescription(dto.description),
        tags: this.normalizeTags(dto.tags) as Prisma.InputJsonValue,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });

    return this.getFullWardrobe(channelId);
  }

  async updateItem(
    channelId: string,
    itemId: number,
    dto: UpdateChannelWardrobeItemDto,
  ): Promise<ChannelWardrobeResponseDto> {
    await this.assertItem(channelId, itemId);
    const category =
      dto.categoryId !== undefined
        ? await this.resolveCategory(channelId, dto.categoryId)
        : null;

    await this.prisma.channelWardrobeItem.update({
      where: { id: itemId },
      data: {
        ...(category ? { categoryId: category.id } : {}),
        ...(dto.title !== undefined
          ? { title: this.normalizeRequiredText(dto.title, '항목 이름') }
          : {}),
        ...(dto.imageUrl !== undefined
          ? { imageUrl: this.normalizeImageUrl(dto.imageUrl) }
          : {}),
        ...(dto.description !== undefined
          ? {
              description: this.normalizeDescription(dto.description),
            }
          : {}),
        ...(dto.tags !== undefined
          ? { tags: this.normalizeTags(dto.tags) as Prisma.InputJsonValue }
          : {}),
        ...(dto.isVisible !== undefined ? { isVisible: dto.isVisible } : {}),
        ...(dto.order !== undefined ? { sortOrder: dto.order } : {}),
      },
    });

    return this.getFullWardrobe(channelId);
  }

  async deleteItem(
    channelId: string,
    itemId: number,
  ): Promise<ChannelWardrobeResponseDto> {
    await this.assertItem(channelId, itemId);

    await this.prisma.channelWardrobeItem.delete({
      where: { id: itemId },
    });

    return this.getFullWardrobe(channelId);
  }

  private async getFullWardrobe(
    channelId: string,
  ): Promise<ChannelWardrobeResponseDto> {
    const [categories, items] = await Promise.all([
      this.prisma.channelWardrobeCategory.findMany({
        where: { channelId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.channelWardrobeItem.findMany({
        where: { channelId },
        orderBy: [
          { category: { sortOrder: 'asc' } },
          { sortOrder: 'asc' },
          { id: 'asc' },
        ],
      }),
    ]);

    return {
      categories: categories.map((category) => this.toCategoryDto(category)),
      items: items.map((item) => this.toItemDto(item)),
    };
  }

  private async ensureDefaultCategories(channelId: string): Promise<void> {
    const categoryCount = await this.prisma.channelWardrobeCategory.count({
      where: { channelId },
    });
    if (categoryCount > 0) return;

    const data = [];
    for (const category of DEFAULT_CHANNEL_WARDROBE_CATEGORIES) data.push({
        id: await nextChannelContentId(this.prisma),
        channelId,
        name: category.name,
        isEnabled: category.isEnabled,
        sortOrder: category.order,
        defaultAspectRatio: category.defaultAspectRatio,
      });
    await this.prisma.channelWardrobeCategory.createMany({ data });
  }

  private async resolveCategory(channelId: string, categoryId?: number) {
    if (categoryId) {
      return this.assertCategory(channelId, categoryId);
    }

    const category = await this.prisma.channelWardrobeCategory.findFirst({
      where: { channelId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    if (!category) {
      throw new BadRequestException('옷장 분류를 찾을 수 없습니다.');
    }
    return category;
  }

  private async assertCategory(channelId: string, categoryId: number) {
    const category = await this.prisma.channelWardrobeCategory.findFirst({
      where: { id: categoryId, channelId },
    });
    if (!category) {
      throw new NotFoundException('옷장 분류를 찾을 수 없습니다.');
    }
    return category;
  }

  private async assertItem(channelId: string, itemId: number) {
    const item = await this.prisma.channelWardrobeItem.findFirst({
      where: { id: itemId, channelId },
    });
    if (!item) {
      throw new NotFoundException('옷장 항목을 찾을 수 없습니다.');
    }
    return item;
  }

  private toCategoryDto(category: {
    id: number;
    name: string;
    defaultAspectRatio: string;
    isEnabled: boolean;
    sortOrder: number;
  }): ChannelWardrobeCategoryDto {
    return {
      id: category.id,
      name: category.name,
      defaultAspectRatio: this.normalizeAspectRatio(category.defaultAspectRatio),
      isEnabled: category.isEnabled,
      order: category.sortOrder,
    };
  }

  private toItemDto(item: {
    id: number;
    categoryId: number;
    title: string;
    imageUrl: string;
    description: string | null;
    tags: Prisma.JsonValue | null;
    isVisible: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }): ChannelWardrobeItemDto {
    return {
      id: item.id,
      categoryId: item.categoryId,
      title: item.title,
      imageUrl: item.imageUrl,
      description: item.description,
      tags: this.normalizeStoredTags(item.tags),
      isVisible: item.isVisible,
      order: item.sortOrder,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private normalizeRequiredText(value: string, label: string): string {
    const normalized = value.trim().slice(0, CHANNEL_WARDROBE_LABEL_MAX_LENGTH);
    if (!normalized) {
      throw new BadRequestException(`${label}을 입력해주세요.`);
    }
    return normalized;
  }

  private normalizeOptionalText(
    value: string | undefined,
    maxLength: number,
  ): string | null {
    const normalized = value?.trim().slice(0, maxLength) ?? '';
    return normalized || null;
  }

  private normalizeDescription(value: string | undefined): string | null {
    const normalized = this.normalizeOptionalText(
      value,
      CHANNEL_WARDROBE_DESCRIPTION_MAX_LENGTH,
    );
    if (!normalized) return null;

    const sanitized = sanitizeSyncPostHtml(normalized)
      .trim()
      .slice(0, CHANNEL_WARDROBE_DESCRIPTION_MAX_LENGTH);
    if (!this.hasMeaningfulDescription(sanitized)) return null;
    return sanitized;
  }

  private hasMeaningfulDescription(value: string): boolean {
    if (/<(img|iframe)\b/i.test(value)) return true;
    const text = value
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim();
    return text.length > 0;
  }

  private normalizeTags(value: string[] | undefined): string[] {
    if (!value) return [];

    const result: string[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
      const tag = raw
        .trim()
        .replace(/^#+/, '')
        .replace(/\s+/g, ' ')
        .slice(0, CHANNEL_WARDROBE_TAG_MAX_LENGTH);
      if (!tag) continue;

      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(tag);
      if (result.length >= CHANNEL_WARDROBE_TAG_MAX_COUNT) break;
    }
    return result;
  }

  private normalizeStoredTags(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) return [];
    return this.normalizeTags(
      value.filter((tag): tag is string => typeof tag === 'string'),
    );
  }

  private normalizeImageUrl(value: string): string {
    const trimmed = value.trim();
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
      return url.toString();
    } catch {
      throw new BadRequestException('이미지 URL은 http 또는 https 주소여야 합니다.');
    }
  }

  private normalizeAspectRatio(value?: string): ChannelWardrobeAspectRatio {
    if (
      value &&
      (CHANNEL_WARDROBE_ASPECT_RATIOS as readonly string[]).includes(value)
    ) {
      return value as ChannelWardrobeAspectRatio;
    }
    return DEFAULT_CHANNEL_WARDROBE_ASPECT_RATIO;
  }
}
