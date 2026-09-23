import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import {
  deleteCategoriesChannelChannelIdCategoriesCategoriesId,
  getCategoriesChannelChannelIdCategories,
  postCategoriesChannelChannelIdCategories,
  postCategoriesChannelChannelIdCategoriesSwapOrder,
  putCategoriesChannelChannelIdCategoriesCategoriesId,
} from "@/meloming/domains/channel/apis/categories";
import type {
  Category,
  PostCategoriesChannelChannelIdCategoriesRequestBody,
  PostCategoriesChannelChannelIdCategoriesResponse,
  PostCategoriesChannelChannelIdCategoriesSwapOrderResponse,
  PutCategoriesChannelChannelIdCategoriesCategoriesIdRequestBody,
  PutCategoriesChannelChannelIdCategoriesCategoriesIdResponse,
  DeleteCategoriesChannelChannelIdCategoriesCategoriesIdResponse,
} from "@/meloming/domains/channel/types/category";

export const categoriesManagementKeys = {
  all: ["categories", "management"] as const,
  channel: (channelId: number) =>
    [...categoriesManagementKeys.all, "channel", channelId] as const,
};

type UpdateCategoryVariables = {
  categoriesId: number;
  body: PutCategoriesChannelChannelIdCategoriesCategoriesIdRequestBody;
  skipInvalidation?: boolean;
};

type DeleteCategoryVariables = {
  categoriesId: number;
};

type SwapCategoryOrderVariables = {
  categoryId: number;
  targetCategoryId: number;
};

type UseCategoriesManagementOptions = {
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number; // alias for gcTime (backward naming compat)
};

export function useCategoriesManagement(
  channelId: number,
  options?: UseCategoriesManagementOptions
): {
  listQuery: UseQueryResult<Category[], Error>;
  createCategory: UseMutationResult<
    PostCategoriesChannelChannelIdCategoriesResponse,
    Error,
    PostCategoriesChannelChannelIdCategoriesRequestBody,
    unknown
  >;
  updateCategory: UseMutationResult<
    PutCategoriesChannelChannelIdCategoriesCategoriesIdResponse,
    Error,
    UpdateCategoryVariables,
    unknown
  >;
  swapCategoryOrder: UseMutationResult<
    PostCategoriesChannelChannelIdCategoriesSwapOrderResponse,
    Error,
    SwapCategoryOrderVariables,
    unknown
  >;
  deleteCategory: UseMutationResult<
    DeleteCategoriesChannelChannelIdCategoriesCategoriesIdResponse,
    Error,
    DeleteCategoryVariables,
    unknown
  >;
  updateAllCategoriesOrder: UseMutationResult<void, Error, Category[], unknown>;
} {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: categoriesManagementKeys.channel(channelId),
    queryFn: () => getCategoriesChannelChannelIdCategories(channelId),
    enabled: !!channelId && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });

  const invalidateList = () =>
    queryClient.invalidateQueries({
      queryKey: categoriesManagementKeys.channel(channelId),
    });

  const createCategory = useMutation({
    mutationFn: (body: PostCategoriesChannelChannelIdCategoriesRequestBody) =>
      postCategoriesChannelChannelIdCategories(channelId, body),
    onSuccess: () => invalidateList(),
  });

  const updateCategory = useMutation({
    mutationFn: ({ categoriesId, body }: UpdateCategoryVariables) =>
      putCategoriesChannelChannelIdCategoriesCategoriesId(
        channelId,
        categoriesId,
        body
      ),
    onSuccess: (_data, variables) => {
      if (variables.skipInvalidation) {
        return;
      }

      return invalidateList();
    },
  });

  const swapCategoryOrder = useMutation({
    mutationFn: ({ categoryId, targetCategoryId }: SwapCategoryOrderVariables) =>
      postCategoriesChannelChannelIdCategoriesSwapOrder(channelId, {
        categoryId,
        targetCategoryId,
      }),
    onSuccess: () => invalidateList(),
  });

  const deleteCategory = useMutation({
    mutationFn: ({ categoriesId }: DeleteCategoryVariables) =>
      deleteCategoriesChannelChannelIdCategoriesCategoriesId(
        channelId,
        categoriesId
      ),
    onSuccess: () => invalidateList(),
  });

  const updateAllCategoriesOrder = useMutation({
    mutationFn: async (reorderedCategories: Category[]) => {
      // 최대 displayOrder 값을 계산 (기존 값이 있으면 그 중 최대값, 없으면 1000 시작)
      const maxExistingOrder = Math.max(
        ...(reorderedCategories
          .map((c) => c.displayOrder ?? 0)
          .filter((o) => o > 0) ?? [0])
      );
      const startOrder =
        maxExistingOrder > 0
          ? maxExistingOrder + 1
          : reorderedCategories.length * 100;

      // 재정렬된 순서에 따라 displayOrder 재계산 (앞에 있을수록 높은 값)
      const updates = reorderedCategories.map((category, index) => ({
        categoriesId: category.id,
        body: {
          name: category.name,
          color: category.color,
          displayOrder: startOrder - index,
        },
      }));

      // 모든 카테고리 업데이트
      await Promise.all(
        updates.map(({ categoriesId, body }) =>
          putCategoriesChannelChannelIdCategoriesCategoriesId(
            channelId,
            categoriesId,
            body
          )
        )
      );
    },
    onSuccess: () => invalidateList(),
  });

  return {
    listQuery,
    createCategory,
    updateCategory,
    swapCategoryOrder,
    deleteCategory,
    updateAllCategoriesOrder,
  };
}
