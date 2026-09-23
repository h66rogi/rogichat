export const WARDROBE_ASPECT_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
] as const;

export const DEFAULT_WARDROBE_ASPECT_RATIO = "1:1";
export const WARDROBE_TAG_MAX_COUNT = 12;
export const WARDROBE_TAG_MAX_LENGTH = 24;

export type WardrobeAspectRatio = (typeof WARDROBE_ASPECT_RATIOS)[number];

export interface ChannelWardrobeCategory {
  id: number;
  name: string;
  defaultAspectRatio: WardrobeAspectRatio;
  isEnabled: boolean;
  order: number;
}

export interface ChannelWardrobeItem {
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

export interface ChannelWardrobe {
  categories: ChannelWardrobeCategory[];
  items: ChannelWardrobeItem[];
}

export interface CreateWardrobeCategoryInput {
  name: string;
  defaultAspectRatio?: WardrobeAspectRatio;
}

export interface UpdateWardrobeCategoryInput {
  name?: string;
  defaultAspectRatio?: WardrobeAspectRatio;
  isEnabled?: boolean;
  order?: number;
}

export interface CreateWardrobeItemInput {
  title: string;
  imageUrl: string;
  categoryId?: number;
  description?: string;
  tags?: string[];
}

export interface UpdateWardrobeItemInput {
  title?: string;
  imageUrl?: string;
  categoryId?: number;
  description?: string;
  tags?: string[];
  isVisible?: boolean;
  order?: number;
}
