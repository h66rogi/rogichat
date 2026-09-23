import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";
import { getTabFromPath, type ChannelTab } from "@/meloming/domains/channel/types/channel-tab";

/**
 * user 페이지의 노래책 관련 필터(URL 쿼리 파라미터)를 관리하는 커스텀 훅입니다.
 * useSearchParams를 기반으로 필터 값을 읽고, 안전하게 업데이트하는 함수를 제공합니다.
 *
 * @returns 필터 상태와 필터 상태를 변경하는 함수들을 포함하는 객체.
 * - `filters`: 현재 URL 쿼리 파라미터와 pathname에 기반한 필터 값 객체.
 * - `setSearchQuery`: 검색어를 업데이트합니다.
 * - `setCategories`: 카테고리 선택 목록을 업데이트합니다.
 * - `toggleCategory`: 카테고리 선택을 토글합니다.
 * - `setArtists`: 아티스트 선택 목록을 업데이트합니다.
 * - `toggleArtist`: 아티스트 선택을 토글합니다.
 * - `setDifficulty`: 난이도 선택을 업데이트합니다.
 * - `setRatingFilter`: 대표 별점 필터를 난이도/숙련도 중 하나로 업데이트합니다.
 * - `clearFilters`: 노래책 필터를 모두 초기화합니다.
 */
export type MusicbookRatingFilterField = "difficulty" | "proficiency";

function parseIdList(value: string | null): string[] {
  if (!value) return [];

  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d+$/.test(item));

  return Array.from(new Set(ids)).sort((a, b) => Number(a) - Number(b));
}

function serializeIdList(ids: readonly string[]): string | undefined {
  const normalized = Array.from(new Set(ids.filter((id) => /^\d+$/.test(id))))
    .sort((a, b) => Number(a) - Number(b));
  return normalized.length > 0 ? normalized.join(",") : undefined;
}

function toggleId(ids: readonly string[], id: string): string[] {
  if (!/^\d+$/.test(id)) return [...ids];

  const next = new Set(ids);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return Array.from(next).sort((a, b) => Number(a) - Number(b));
}

export const useMusicbookFilters = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo(
    () => {
      const categoryIds = parseIdList(searchParams.get("category"));
      const artistIds = parseIdList(searchParams.get("artist"));

      return {
        tab: getTabFromPath(pathname) as ChannelTab,
        searchQuery: searchParams.get("q") || "",
        categoryIds,
        artistIds,
        categoryId: categoryIds[0] ?? null,
        artistId: artistIds[0] ?? null,
        difficulty: searchParams.get("difficulty"),
        proficiency: searchParams.get("proficiency"),
      };
    },
    [searchParams, pathname]
  );

  const updateParams = useCallback(
    (key: string, value: string | undefined | null) => {
      const newParams = new URLSearchParams(searchParams.toString());
      // Ensure transient params are always cleared
      newParams.delete("openSongId");
      newParams.delete("editId");
      if (value) {
        newParams.set(key, value);
      } else {
        newParams.delete(key);
      }

      // 필터 변경 시 페이지네이션은 1페이지로 초기화
      if (key !== "page") {
        newParams.delete("page");
      }

      const queryString = newParams.toString();
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(newUrl);
    },
    [searchParams, router, pathname]
  );

  const setSearchQuery = useCallback(
    (query: string | undefined) => updateParams("q", query),
    [updateParams]
  );

  const setCategories = useCallback(
    (ids: readonly string[]) => {
      updateParams("category", serializeIdList(ids));
    },
    [updateParams]
  );

  const toggleCategory = useCallback(
    (id: string) => {
      const current = parseIdList(searchParams.get("category"));
      updateParams("category", serializeIdList(toggleId(current, id)));
    },
    [searchParams, updateParams]
  );

  const setCategory = useCallback(
    (id: string | undefined) => {
      updateParams("category", id);
    },
    [updateParams]
  );

  const setArtists = useCallback(
    (ids: readonly string[]) => {
      updateParams("artist", serializeIdList(ids));
    },
    [updateParams]
  );

  const toggleArtist = useCallback(
    (id: string) => {
      const current = parseIdList(searchParams.get("artist"));
      updateParams("artist", serializeIdList(toggleId(current, id)));
    },
    [searchParams, updateParams]
  );

  const setArtist = useCallback(
    (id: string | undefined) => {
      updateParams("artist", id);
    },
    [updateParams]
  );

  const setDifficulty = useCallback(
    (level: string | undefined) => {
      updateParams("difficulty", level);
    },
    [updateParams]
  );

  const setRatingFilter = useCallback(
    (field: MusicbookRatingFilterField, level: string | undefined) => {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("openSongId");
      newParams.delete("editId");
      newParams.delete("page");
      newParams.delete("difficulty");
      newParams.delete("proficiency");

      if (level) {
        newParams.set(field, level);
      }

      const queryString = newParams.toString();
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(newUrl);
    },
    [searchParams, router, pathname]
  );

  const clearFilters = useCallback(() => {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.delete("q");
    newParams.delete("category");
    newParams.delete("artist");
    newParams.delete("difficulty");
    newParams.delete("proficiency");
    newParams.delete("page");
    newParams.delete("openSongId");
    newParams.delete("editId");

    const queryString = newParams.toString();
    const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
    router.replace(newUrl);
  }, [searchParams, router, pathname]);

  return {
    filters,
    setSearchQuery,
    setCategories,
    toggleCategory,
    setCategory,
    setArtists,
    toggleArtist,
    setArtist,
    setDifficulty,
    setRatingFilter,
    clearFilters,
  };
};
