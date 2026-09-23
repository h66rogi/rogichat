/**
 * Domain
 */

export interface Category {
  id: number;
  name: string;
  color: string;
  channelId: number;
  createdAt: string;
  songCount: number;
  displayOrder?: number;
  price?: number | null; // 신청곡 가격
  currencyPrices?: Record<string, number | null> | null; // 재화별 신청곡 가격
  channel: {
    id: number;
    name: string;
    user: {
      id: number;
      nickname: string;
    };
  };
}

/**
 * Dto
 */

export type GetCategoriesPublicWebPathResponse = Category[];

export type GetCategoriesChannelChannelIdCategoriesResponse = Category[];

export interface PostCategoriesChannelChannelIdCategoriesRequestBody {
  name: string;
  color: string;
  displayOrder?: number;
  price?: number | null;
  currencyPrices?: Record<string, number | null> | null;
}

export interface PostCategoriesChannelChannelIdCategoriesSwapOrderRequestBody {
  categoryId: number;
  targetCategoryId: number;
}

export type PostCategoriesChannelChannelIdCategoriesResponse = Pick<
  Category,
  | "id"
  | "name"
  | "color"
  | "channelId"
  | "createdAt"
  | "displayOrder"
  | "price"
  | "currencyPrices"
>;

export type PutCategoriesChannelChannelIdCategoriesCategoriesIdRequestBody =
  PostCategoriesChannelChannelIdCategoriesRequestBody;

export type PutCategoriesChannelChannelIdCategoriesCategoriesIdResponse = Pick<
  Category,
  | "id"
  | "name"
  | "color"
  | "channelId"
  | "createdAt"
  | "displayOrder"
  | "price"
  | "currencyPrices"
>;

export interface DeleteCategoriesChannelChannelIdCategoriesCategoriesIdResponse {
  message: string;
}

export type PostCategoriesChannelChannelIdCategoriesSwapOrderResponse = Array<
  Pick<
    Category,
    | "id"
    | "name"
    | "color"
    | "channelId"
    | "createdAt"
    | "displayOrder"
    | "price"
    | "currencyPrices"
  >
>;
