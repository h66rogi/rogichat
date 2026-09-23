import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { getCategoriesPublicWebPath } from "@/meloming/domains/channel/apis/categories";
import type { Category } from "@/meloming/domains/channel/types/category";

// Query keys
export const categoriesKeys = {
  all: ["categories"] as const,
  user: (username: string) =>
    [...categoriesKeys.all, "user", username] as const,
};

/**
 * 특정 사용자의 카테고리 목록을 가져오는 훅
 * @param username - 사용자 이름
 * @param options - useQuery 옵션
 */
export function useUserCategories(
  username: string,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
  }
): UseQueryResult<Category[], Error> {
  return useQuery({
    queryKey: categoriesKeys.user(username),
    queryFn: () => getCategoriesPublicWebPath(username),
    enabled: !!username && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.cacheTime ?? 10 * 60 * 1000, // 10분 (구 cacheTime)
  });
}
