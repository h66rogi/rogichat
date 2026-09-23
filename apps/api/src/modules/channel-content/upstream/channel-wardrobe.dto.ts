// Shape-preserving DTO port from meloming-back a91393b2
// src/channel/dto/channel-wardrobe.dto.ts. Rogichat validates at its HTTP edge.
export interface ChannelWardrobeCategoryDto {
  id: number;
  name: string;
  defaultAspectRatio: string;
  isEnabled: boolean;
  order: number;
}
export interface ChannelWardrobeItemDto {
  id: number;
  categoryId: number;
  title: string;
  imageUrl: string;
  description: string | null;
  tags: string[];
  isVisible: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}
export interface ChannelWardrobeResponseDto {
  categories: ChannelWardrobeCategoryDto[];
  items: ChannelWardrobeItemDto[];
}
export interface CreateChannelWardrobeCategoryDto {
  name: string;
  defaultAspectRatio?: string;
}
export interface UpdateChannelWardrobeCategoryDto {
  name?: string;
  defaultAspectRatio?: string;
  isEnabled?: boolean;
  order?: number;
}
export interface CreateChannelWardrobeItemDto {
  title: string;
  imageUrl: string;
  categoryId?: number;
  description?: string;
  tags?: string[];
}
export interface UpdateChannelWardrobeItemDto {
  title?: string;
  imageUrl?: string;
  categoryId?: number;
  description?: string;
  tags?: string[];
  isVisible?: boolean;
  order?: number;
}
