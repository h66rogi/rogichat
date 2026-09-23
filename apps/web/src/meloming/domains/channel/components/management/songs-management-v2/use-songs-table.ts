import { useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { SortingState, PaginationState } from "@tanstack/react-table";

// API sortBy 타입
type ApiSortBy = "newest" | "oldest" | "title" | "artist" | "likes_desc";

// Tanstack Table의 정렬 상태를 API sortBy로 변환
function sortingToApiSortBy(sorting: SortingState): ApiSortBy {
  if (sorting.length === 0) {
    return "newest";
  }

  const { id, desc } = sorting[0];

  switch (id) {
    case "createdAt":
      return desc ? "newest" : "oldest";
    case "title":
      return "title";
    case "artist":
      return "artist";
    case "totalFavorites":
      return "likes_desc";
    default:
      return "newest";
  }
}

// API sortBy를 Tanstack Table 정렬 상태로 변환
function apiSortByToSorting(sortBy: ApiSortBy): SortingState {
  switch (sortBy) {
    case "newest":
      return [{ id: "createdAt", desc: true }];
    case "oldest":
      return [{ id: "createdAt", desc: false }];
    case "title":
      return [{ id: "title", desc: false }];
    case "artist":
      return [{ id: "artist", desc: false }];
    case "likes_desc":
      return [{ id: "totalFavorites", desc: true }];
    default:
      return [{ id: "createdAt", desc: true }];
  }
}

export function useSongsTable() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL에서 정렬과 페이지네이션 상태 읽기
  const sortByParam = (searchParams.get("sortBy") as ApiSortBy) || "newest";
  const pageParam = parseInt(searchParams.get("page") || "1", 10);
  const pageSizeParam = parseInt(searchParams.get("pageSize") || "30", 10);

  // Tanstack Table 정렬 상태
  const [sorting, setSorting] = useState<SortingState>(() =>
    apiSortByToSorting(sortByParam)
  );

  // Tanstack Table 페이지네이션 상태
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: pageParam - 1, // 0-indexed
    pageSize: pageSizeParam,
  });

  // API용 sortBy
  const apiSortBy = useMemo(() => sortingToApiSortBy(sorting), [sorting]);

  // URL 업데이트 헬퍼
  const updateUrl = useCallback(
    (updates: Record<string, string | undefined>) => {
      const newParams = new URLSearchParams(searchParams.toString());

      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined) {
          newParams.delete(key);
        } else {
          newParams.set(key, value);
        }
      });

      const queryString = newParams.toString();
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(newUrl);
    },
    [searchParams, router, pathname]
  );

  // 정렬 변경 핸들러
  const onSortingChange = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      setSorting(newSorting);

      const newSortBy = sortingToApiSortBy(newSorting);

      // 정렬 변경 시 페이지는 1로 리셋
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));

      updateUrl({
        sortBy: newSortBy === "newest" ? undefined : newSortBy,
        page: undefined, // 1페이지면 URL에서 제거
      });
    },
    [sorting, updateUrl]
  );

  // 페이지 변경 핸들러
  const onPaginationChange = useCallback(
    (
      updater: PaginationState | ((prev: PaginationState) => PaginationState)
    ) => {
      const newPagination =
        typeof updater === "function" ? updater(pagination) : updater;
      setPagination(newPagination);

      updateUrl({
        page:
          newPagination.pageIndex === 0
            ? undefined
            : String(newPagination.pageIndex + 1),
        pageSize:
          newPagination.pageSize === 30
            ? undefined
            : String(newPagination.pageSize),
      });
    },
    [pagination, updateUrl]
  );

  // 페이지 크기 변경 핸들러
  const onPageSizeChange = useCallback(
    (newPageSize: number) => {
      setPagination({ pageIndex: 0, pageSize: newPageSize });

      updateUrl({
        page: undefined,
        pageSize: newPageSize === 30 ? undefined : String(newPageSize),
      });
    },
    [updateUrl]
  );

  return {
    // 상태
    sorting,
    pagination,
    apiSortBy,

    // 핸들러
    onSortingChange,
    onPaginationChange,
    onPageSizeChange,

    // 계산된 값
    pageIndex: pagination.pageIndex,
    pageSize: pagination.pageSize,
    page: pagination.pageIndex + 1, // 1-indexed for API
  };
}
