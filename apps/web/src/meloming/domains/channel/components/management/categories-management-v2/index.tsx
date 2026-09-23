"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import type { ChangeEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { useCategoriesManagement } from "@/meloming/domains/channel/hooks/use-categories-management";
import { Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/meloming/shared/components/ui/button";
import { InlineError } from "@/meloming/shared/components/common/error-boundary";
import { Input } from "@/meloming/shared/components/ui/input";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import {
  hasInvalidCategoryDisplayOrder,
  normalizeCategoryDisplayOrder,
  sortCategories,
  swapCategoryDisplayOrder,
} from "@/meloming/domains/channel/utils/category-sort";
import type { Category } from "@/meloming/domains/channel/types/category";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import type { CategoryFormData } from "../types";
import CategoryEditDialog from "@/meloming/shared/components/common/category-edit-dialog";
import { DEFAULT_CATEGORY_COLORS } from "@/meloming/shared/constants/category";
import { ManagementHeader } from "../management-header";
import { usePricingSettings } from "@/meloming/domains/channel/hooks/use-pricing-settings";
import type { RowSelectionState } from "@tanstack/react-table";

import { CategoriesTable } from "./categories-table";
import {
  colorFamily,
  countBucket,
  getApiErrorStatus,
  getCategoryChangeSummary,
  getCategoryFormSummary,
  getCategoryListSummary,
  getCategorySelectionSummary,
  getCategorySummary,
  getErrorName,
  numericValueBucket,
  textLengthBucket,
} from "../songbook-analytics";

function getSelectedCategoryIds(selection: RowSelectionState): number[] {
  return Object.keys(selection)
    .filter((key) => selection[key])
    .map(Number)
    .sort((left, right) => left - right);
}

function haveSameIds(left: number[], right: number[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

type IntentEventProperties = NonNullable<
  Parameters<typeof captureIntentEvent>[1]
>;

function captureIntentEventSafely(
  eventName: string,
  getProperties: () => IntentEventProperties
): void {
  try {
    captureIntentEvent(eventName, getProperties());
  } catch (error) {
    console.error("카테고리 관리 이벤트 캡처 실패:", error);
  }
}

export function CategoriesManagementV2() {
  const { user } = useParams();
  const userParam = Array.isArray(user) ? user[0] : user;
  const username = userParam || "";

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<{
    id: number;
    name: string;
    color: string;
    price?: number | null;
    currencyPrices?: Record<string, number | null> | null;
  } | null>(null);
  const [deleteCategory, setDeleteCategory] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const pageViewCapturedRef = useRef(false);
  const listLoadSignatureRef = useRef<string | null>(null);
  const searchEmptySignatureRef = useRef<string | null>(null);
  const searchFocusCapturedRef = useRef(false);
  const pricingNoticeCapturedRef = useRef(false);
  const categoryDialogCloseReasonRef = useRef("dismissed");
  const categoryNameFocusCapturedRef = useRef(false);
  const categoryNameEditedCapturedRef = useRef(false);
  const deleteDialogCloseReasonRef = useRef("dismissed");
  const deleteDialogClosedCapturedRef = useRef(false);
  const bulkDeleteDialogCloseReasonRef = useRef("dismissed");
  const bulkDeleteDialogClosedCapturedRef = useRef(false);

  // 공개 유저 정보에서 채널 ID를 얻어 관리 API에 사용
  const { data: publicUser } = useChannel(username);
  const channelId = publicUser?.id ?? 0;

  const {
    listQuery,
    createCategory,
    updateCategory,
    swapCategoryOrder: swapCategoryOrderMutation,
    deleteCategory: deleteCategoryMutation,
  } = useCategoriesManagement(channelId, { enabled: channelId > 0 });

  // 가격 설정 조회
  const { data: pricingSettings } = usePricingSettings(channelId || undefined);
  const isPricingEnabled = pricingSettings?.pricingEnabled ?? false;
  const currencyUnit = pricingSettings?.currencyUnit ?? "";
  const currencyConfigs = useMemo(
    () =>
      (pricingSettings?.currencyConfigs ?? []).filter(
        (config) => config.key?.trim() && config.unit?.trim()
      ),
    [pricingSettings?.currencyConfigs]
  );
  const { data: serverCategories, isLoading, error, refetch } = listQuery;

  // 로컬 상태로 카테고리 관리 (순서 변경 시 즉시 반영)
  const [localCategories, setLocalCategories] = useState<
    Category[] | undefined
  >(undefined);

  // 순서 변경 중 연속 클릭 방지 (UI 렌더링 불필요, ref 사용)
  const isSwappingRef = useRef(false);

  // displayOrder 초기화 중복 실행 방지
  const isInitializingRef = useRef(false);

  // 서버 데이터가 업데이트되면 로컬 상태도 업데이트
  useEffect(() => {
    if (serverCategories) {
      setLocalCategories(serverCategories);
    }
  }, [serverCategories]);

  // displayOrder가 비어 있거나 중복된 카테고리가 있으면 자동으로 정규화
  useEffect(() => {
    if (!serverCategories || serverCategories.length === 0) return;
    if (isInitializingRef.current) return;

    if (!hasInvalidCategoryDisplayOrder(serverCategories)) return;

    isInitializingRef.current = true;
    let isMounted = true;

    const normalizedCategories = normalizeCategoryDisplayOrder(serverCategories);
    const updates = normalizedCategories
      .map((cat) => {
        const currentCategory = serverCategories.find(
          (serverCategory) => serverCategory.id === cat.id
        );

        return {
          id: cat.id,
          name: cat.name,
          color: cat.color,
          newOrder: cat.displayOrder ?? 0,
          needsUpdate: currentCategory?.displayOrder !== cat.displayOrder,
        };
      })
      .filter((u) => u.needsUpdate);

    if (updates.length === 0) {
      isInitializingRef.current = false;
      return;
    }

    (async () => {
      try {
        await Promise.all(
          updates.map((u) =>
            updateCategory.mutateAsync({
              categoriesId: u.id,
              body: { name: u.name, color: u.color, displayOrder: u.newOrder },
              skipInvalidation: true,
            })
          )
        );
        if (isMounted) await refetch();
      } catch (err) {
        console.error("displayOrder 초기화 실패:", err);
      } finally {
        isInitializingRef.current = false;
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [serverCategories, updateCategory, refetch]);

  const categories = localCategories ?? serverCategories;

  // 정렬된 카테고리
  const sortedCategories = useMemo(() => {
    if (!categories) return [];
    return sortCategories(categories);
  }, [categories]);

  // 검색 필터링
  const filteredCategories = useMemo(() => {
    if (!sortedCategories || sortedCategories.length === 0) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedCategories;
    return sortedCategories.filter((c) => c.name.toLowerCase().includes(q));
  }, [sortedCategories, searchQuery]);

  // 선택된 ID 계산
  const selectedIds = useMemo(() => {
    return getSelectedCategoryIds(rowSelection);
  }, [rowSelection]);

  const getListContextProperties = useCallback(
    () => ({
      channel_id: channelId || null,
      channel_username_present: Boolean(username),
      pricing_enabled: isPricingEnabled,
      currency_config_count: currencyConfigs.length,
      currency_config_count_bucket: countBucket(currencyConfigs.length),
      search_active: searchQuery.trim().length > 0,
      search_query_length_bucket: textLengthBucket(searchQuery),
      filtered_category_count: filteredCategories.length,
      filtered_category_count_bucket: countBucket(filteredCategories.length),
      ...getCategoryListSummary(sortedCategories),
      ...getCategorySelectionSummary(selectedIds, filteredCategories),
    }),
    [
      channelId,
      username,
      isPricingEnabled,
      currencyConfigs.length,
      searchQuery,
      filteredCategories,
      selectedIds,
      sortedCategories,
    ]
  );

  const getCategoryPositionProperties = useCallback(
    (category: Category) => {
      const sortedIndex = sortedCategories.findIndex((c) => c.id === category.id);
      const filteredIndex = filteredCategories.findIndex(
        (c) => c.id === category.id
      );

      return {
        category_sorted_index: sortedIndex >= 0 ? sortedIndex : null,
        category_sorted_position_bucket:
          sortedIndex >= 0 ? countBucket(sortedIndex + 1) : "unknown",
        category_filtered_index: filteredIndex >= 0 ? filteredIndex : null,
        category_filtered_position_bucket:
          filteredIndex >= 0 ? countBucket(filteredIndex + 1) : "unknown",
        category_is_first: sortedIndex === 0,
        category_is_last:
          sortedIndex >= 0 && sortedIndex === sortedCategories.length - 1,
      };
    },
    [filteredCategories, sortedCategories]
  );

  const getDeleteCategoryProperties = useCallback(
    (category: { id: number; name: string } | null | undefined) => {
      const fullCategory = category
        ? sortedCategories.find((item) => item.id === category.id)
        : null;

      return {
        ...getListContextProperties(),
        ...getCategorySummary(fullCategory, "category"),
        ...(fullCategory ? getCategoryPositionProperties(fullCategory) : {}),
      };
    },
    [getCategoryPositionProperties, getListContextProperties, sortedCategories]
  );

  useEffect(() => {
    if (!channelId || pageViewCapturedRef.current) return;
    pageViewCapturedRef.current = true;
    captureIntentEvent("channel_songbook_categories_viewed", {
      ...getListContextProperties(),
      list_ready: Boolean(serverCategories),
    });
  }, [channelId, getListContextProperties, serverCategories]);

  useEffect(() => {
    if (!error) return;
    captureIntentEvent("channel_songbook_categories_list_load_failed", {
      channel_id: channelId || null,
      channel_username_present: Boolean(username),
      error_name: getErrorName(error),
      error_status: getApiErrorStatus(error),
    });
  }, [channelId, error, username]);

  useEffect(() => {
    if (!serverCategories) return;

    const signature = serverCategories
      .map((category) =>
        [
          category.id,
          category.displayOrder ?? "unset",
          category.songCount ?? 0,
          category.price ?? "unset",
          Object.keys(category.currencyPrices ?? {}).length,
        ].join(":")
      )
      .join("|");
    if (listLoadSignatureRef.current === signature) return;
    listLoadSignatureRef.current = signature;

    const summary = {
      channel_id: channelId || null,
      channel_username_present: Boolean(username),
      pricing_enabled: isPricingEnabled,
      currency_config_count: currencyConfigs.length,
      currency_config_count_bucket: countBucket(currencyConfigs.length),
      ...getCategoryListSummary(serverCategories),
    };

    captureIntentEvent("channel_songbook_categories_list_loaded", summary);
    if (serverCategories.length === 0) {
      captureIntentEvent("channel_songbook_categories_empty_state_viewed", {
        ...summary,
        empty_state_source: "initial_list",
      });
    }
  }, [
    channelId,
    currencyConfigs.length,
    isPricingEnabled,
    serverCategories,
    username,
  ]);

  useEffect(() => {
    if (!pricingSettings || isPricingEnabled || pricingNoticeCapturedRef.current) {
      return;
    }
    pricingNoticeCapturedRef.current = true;
    captureIntentEvent("channel_songbook_categories_pricing_disabled_notice_viewed", {
      ...getListContextProperties(),
    });
  }, [getListContextProperties, isPricingEnabled, pricingSettings]);

  useEffect(() => {
    const trimmedQuery = searchQuery.trim();
    if (
      !trimmedQuery ||
      sortedCategories.length === 0 ||
      filteredCategories.length > 0
    ) {
      return;
    }

    const signature = `${textLengthBucket(trimmedQuery)}:${sortedCategories.length}`;
    if (searchEmptySignatureRef.current === signature) return;
    searchEmptySignatureRef.current = signature;
    captureIntentEvent("channel_songbook_categories_search_empty_state_viewed", {
      ...getListContextProperties(),
      empty_state_source: "search",
    });
  }, [
    filteredCategories.length,
    getListContextProperties,
    searchQuery,
    sortedCategories.length,
  ]);

  const handleOpenDialog = (
    category?: {
      id: number;
      name: string;
      color: string;
      price?: number | null;
      currencyPrices?: Record<string, number | null> | null;
    },
    source = "header"
  ) => {
    setEditingCategory(category ?? null);
    categoryDialogCloseReasonRef.current = "dismissed";
    categoryNameFocusCapturedRef.current = false;
    categoryNameEditedCapturedRef.current = false;
    setIsDialogOpen(true);

    if (category) {
      const fullCategory = sortedCategories.find((item) => item.id === category.id);
      captureIntentEvent("channel_songbook_categories_edit_dialog_opened", {
        ...getListContextProperties(),
        ...getCategorySummary(fullCategory ?? category, "category"),
        ...(fullCategory ? getCategoryPositionProperties(fullCategory) : {}),
        dialog_source: source,
      });
      return;
    }

    captureIntentEvent("channel_songbook_categories_create_dialog_opened", {
      ...getListContextProperties(),
      dialog_source: source,
    });
  };

  const handleCloseDialog = (reason = categoryDialogCloseReasonRef.current) => {
    const mode = editingCategory ? "edit" : "create";
    const fullCategory = editingCategory
      ? sortedCategories.find((item) => item.id === editingCategory.id)
      : null;

    const eventProperties = {
      ...getListContextProperties(),
      ...(editingCategory
        ? {
            ...getCategorySummary(fullCategory ?? editingCategory, "category"),
            ...(fullCategory ? getCategoryPositionProperties(fullCategory) : {}),
          }
        : {}),
      close_reason: reason,
    };

    if (mode === "edit") {
      captureIntentEvent(
        "channel_songbook_categories_edit_dialog_closed",
        eventProperties
      );
    } else {
      captureIntentEvent(
        "channel_songbook_categories_create_dialog_closed",
        eventProperties
      );
    }
    setIsDialogOpen(false);
    setEditingCategory(null);
  };

  const onSubmit = async (data: CategoryFormData) => {
    const mode = editingCategory ? "edit" : "create";
    const fullCategory = editingCategory
      ? sortedCategories.find((item) => item.id === editingCategory.id)
      : null;
    const eventProperties = {
      ...getListContextProperties(),
      ...(editingCategory
        ? {
            ...getCategorySummary(fullCategory ?? editingCategory, "category"),
            ...(fullCategory ? getCategoryPositionProperties(fullCategory) : {}),
            ...getCategoryChangeSummary(editingCategory, data),
          }
        : {}),
      ...getCategoryFormSummary(data),
    };

    if (mode === "edit") {
      captureIntentEvent("channel_songbook_categories_edit_save_submitted", {
        ...eventProperties,
      });
    } else {
      captureIntentEvent("channel_songbook_categories_create_save_submitted", {
        ...eventProperties,
      });
    }

    try {
      if (!channelId) {
        if (mode === "edit") {
          captureIntentEvent(
            "channel_songbook_categories_edit_save_blocked_channel_missing",
            eventProperties
          );
        } else {
          captureIntentEvent(
            "channel_songbook_categories_create_save_blocked_channel_missing",
            eventProperties
          );
        }
        return;
      }
      if (editingCategory) {
        await updateCategory.mutateAsync({
          categoriesId: editingCategory.id,
          body: {
            name: data.name,
            color: data.color,
            price: data.price,
            currencyPrices: data.currencyPrices,
          },
        });
        captureIntentEvent("channel_songbook_categories_edit_save_succeeded", {
          ...eventProperties,
        });
      } else {
        // 새 카테고리 추가 시 최대 displayOrder + 1 설정
        const maxOrder = Math.max(
          ...(categories?.map((c) => c.displayOrder ?? 0) ?? [0])
        );
        const newDisplayOrder = maxOrder > 0 ? maxOrder + 1 : 1000;

        await createCategory.mutateAsync({
          name: data.name,
          color: data.color,
          displayOrder: newDisplayOrder,
          price: data.price,
          currencyPrices: data.currencyPrices,
        });
        captureIntentEvent("channel_songbook_categories_create_save_succeeded", {
          ...eventProperties,
          assigned_display_order_bucket: numericValueBucket(newDisplayOrder),
        });
      }
      categoryDialogCloseReasonRef.current = "saved";
      handleCloseDialog("saved");
      await refetch();
    } catch (error) {
      console.error("카테고리 저장 실패:", error);
      if (mode === "edit") {
        captureIntentEvent("channel_songbook_categories_edit_save_failed", {
          ...eventProperties,
          error_name: getErrorName(error),
          error_status: getApiErrorStatus(error),
        });
      } else {
        captureIntentEvent("channel_songbook_categories_create_save_failed", {
          ...eventProperties,
          error_name: getErrorName(error),
          error_status: getApiErrorStatus(error),
        });
      }
    }
  };

  // 두 카테고리의 displayOrder를 스왑하는 함수
  const swapCategoryOrder = useCallback(
    async (
      cat1: Category,
      cat2: Category,
      direction: "up" | "down",
      fromIndex: number,
      toIndex: number
    ) => {
      const eventProperties = {
        ...getListContextProperties(),
        ...getCategorySummary(cat1, "category"),
        ...getCategoryPositionProperties(cat1),
        target_category_id: cat2.id,
        target_category_song_count: cat2.songCount ?? 0,
        target_category_song_count_bucket: countBucket(cat2.songCount ?? 0),
        direction,
        from_index: fromIndex,
        to_index: toIndex,
      };

      isSwappingRef.current = true;
      captureIntentEvent("channel_songbook_categories_order_move_submitted", {
        ...eventProperties,
      });
      try {
        await swapCategoryOrderMutation.mutateAsync({
          categoryId: cat1.id,
          targetCategoryId: cat2.id,
        });
        captureIntentEvent("channel_songbook_categories_order_move_succeeded", {
          ...eventProperties,
        });
        toast.success("카테고리 순서가 변경되었습니다");
      } catch (error) {
        console.error("카테고리 순서 업데이트 실패:", error);
        captureIntentEvent("channel_songbook_categories_order_move_failed", {
          ...eventProperties,
          error_name: getErrorName(error),
          error_status: getApiErrorStatus(error),
        });
        toast.error("카테고리 순서 변경에 실패했습니다");
        setLocalCategories(serverCategories);
      } finally {
        isSwappingRef.current = false;
      }
    },
    [
      getCategoryPositionProperties,
      getListContextProperties,
      serverCategories,
      swapCategoryOrderMutation,
    ]
  );

  // 위로 이동
  const handleMoveUp = useCallback(
    (category: Category) => {
      const eventProperties = {
        ...getListContextProperties(),
        ...getCategorySummary(category, "category"),
        ...getCategoryPositionProperties(category),
        direction: "up",
      };

      if (isSwappingRef.current || isInitializingRef.current) {
        captureIntentEvent("channel_songbook_categories_order_move_blocked_busy", {
          ...eventProperties,
        });
        return;
      }
      const index = sortedCategories.findIndex((c) => c.id === category.id);
      if (index <= 0) {
        captureIntentEvent(
          "channel_songbook_categories_order_move_blocked_boundary",
          {
            ...eventProperties,
            boundary: "first",
          }
        );
        return;
      }

      const prevCategory = sortedCategories[index - 1];
      const currentCategory = sortedCategories[index];

      captureIntentEvent("channel_songbook_categories_order_move_clicked", {
        ...eventProperties,
        target_category_id: prevCategory.id,
        target_category_song_count: prevCategory.songCount ?? 0,
        target_category_song_count_bucket: countBucket(
          prevCategory.songCount ?? 0
        ),
        from_index: index,
        to_index: index - 1,
      });

      setLocalCategories(
        swapCategoryDisplayOrder(
          sortedCategories,
          currentCategory.id,
          prevCategory.id
        )
      );

      swapCategoryOrder(currentCategory, prevCategory, "up", index, index - 1);
    },
    [
      getCategoryPositionProperties,
      getListContextProperties,
      sortedCategories,
      swapCategoryOrder,
    ]
  );

  // 아래로 이동
  const handleMoveDown = useCallback(
    (category: Category) => {
      const eventProperties = {
        ...getListContextProperties(),
        ...getCategorySummary(category, "category"),
        ...getCategoryPositionProperties(category),
        direction: "down",
      };

      if (isSwappingRef.current || isInitializingRef.current) {
        captureIntentEvent("channel_songbook_categories_order_move_blocked_busy", {
          ...eventProperties,
        });
        return;
      }
      const index = sortedCategories.findIndex((c) => c.id === category.id);
      if (index < 0 || index >= sortedCategories.length - 1) {
        captureIntentEvent(
          "channel_songbook_categories_order_move_blocked_boundary",
          {
            ...eventProperties,
            boundary: "last",
          }
        );
        return;
      }

      const nextCategory = sortedCategories[index + 1];
      const currentCategory = sortedCategories[index];

      captureIntentEvent("channel_songbook_categories_order_move_clicked", {
        ...eventProperties,
        target_category_id: nextCategory.id,
        target_category_song_count: nextCategory.songCount ?? 0,
        target_category_song_count_bucket: countBucket(
          nextCategory.songCount ?? 0
        ),
        from_index: index,
        to_index: index + 1,
      });

      setLocalCategories(
        swapCategoryDisplayOrder(
          sortedCategories,
          currentCategory.id,
          nextCategory.id
        )
      );

      swapCategoryOrder(currentCategory, nextCategory, "down", index, index + 1);
    },
    [
      getCategoryPositionProperties,
      getListContextProperties,
      sortedCategories,
      swapCategoryOrder,
    ]
  );

  // 개별 삭제
  const handleDelete = async () => {
    const eventProperties = getDeleteCategoryProperties(deleteCategory);
    deleteDialogCloseReasonRef.current = "confirm_clicked";
    captureIntentEvent("channel_songbook_categories_delete_confirm_clicked", {
      ...eventProperties,
    });
    captureIntentEvent("channel_songbook_categories_delete_submitted", {
      ...eventProperties,
    });

    if (!deleteCategory) {
      captureIntentEvent("channel_songbook_categories_delete_blocked_missing_target", {
        ...eventProperties,
      });
      return;
    }

    try {
      if (!channelId) {
        captureIntentEvent("channel_songbook_categories_delete_blocked_channel_missing", {
          ...eventProperties,
        });
        return;
      }
      await deleteCategoryMutation.mutateAsync({
        categoriesId: deleteCategory.id,
      });
      captureIntentEvent("channel_songbook_categories_delete_succeeded", {
        ...eventProperties,
      });
      deleteDialogCloseReasonRef.current = "succeeded";
      captureDeleteDialogClosed("succeeded");
      // 선택 상태에서 제거
      setRowSelection((prev) => {
        const next = { ...prev };
        delete next[String(deleteCategory.id)];
        return next;
      });
      setDeleteCategory(null);
      await refetch();
    } catch (error) {
      console.error("카테고리 삭제 실패:", error);
      captureIntentEvent("channel_songbook_categories_delete_failed", {
        ...eventProperties,
        error_name: getErrorName(error),
        error_status: getApiErrorStatus(error),
      });
    }
  };

  // 일괄 삭제
  const handleBulkDelete = async () => {
    const eventProperties = {
      ...getListContextProperties(),
      ...getCategorySelectionSummary(selectedIds, filteredCategories),
    };

    bulkDeleteDialogCloseReasonRef.current = "confirm_clicked";
    captureIntentEvent("channel_songbook_categories_bulk_delete_confirm_clicked", {
      ...eventProperties,
    });
    captureIntentEvent("channel_songbook_categories_bulk_delete_submitted", {
      ...eventProperties,
    });

    if (!channelId) {
      captureIntentEvent(
        "channel_songbook_categories_bulk_delete_blocked_channel_missing",
        eventProperties
      );
      return;
    }
    if (selectedIds.length === 0) {
      captureIntentEvent("channel_songbook_categories_bulk_delete_blocked_empty", {
        ...eventProperties,
      });
      return;
    }

    try {
      setIsBulkDeleting(true);
      // 순차적으로 삭제
      for (const id of selectedIds) {
        await deleteCategoryMutation.mutateAsync({ categoriesId: id });
      }
      toast.success("일괄 삭제 완료", {
        description: `${selectedIds.length}개 카테고리가 삭제되었습니다.`,
      });
      captureIntentEvent("channel_songbook_categories_bulk_delete_succeeded", {
        ...eventProperties,
      });
      bulkDeleteDialogCloseReasonRef.current = "succeeded";
      setRowSelection({});
      await refetch();
    } catch (error) {
      console.error("일괄 삭제 실패:", error);
      bulkDeleteDialogCloseReasonRef.current = "failed";
      captureIntentEvent("channel_songbook_categories_bulk_delete_failed", {
        ...eventProperties,
        error_name: getErrorName(error),
        error_status: getApiErrorStatus(error),
      });
      toast.error("일괄 삭제 실패", {
        description: "잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsBulkDeleting(false);
      captureBulkDeleteDialogClosed();
      setShowBulkDeleteDialog(false);
    }
  };

  // 수정 핸들러
  const handleEdit = useCallback((category: Category) => {
    setEditingCategory({
      id: category.id,
      name: category.name,
      color: category.color,
      price: category.price,
      currencyPrices: category.currencyPrices ?? null,
    });
    categoryDialogCloseReasonRef.current = "dismissed";
    categoryNameFocusCapturedRef.current = false;
    categoryNameEditedCapturedRef.current = false;
    setIsDialogOpen(true);
    captureIntentEventSafely("channel_songbook_categories_edit_clicked", () => ({
      ...getListContextProperties(),
      ...getCategorySummary(category, "category"),
      ...getCategoryPositionProperties(category),
    }));
    captureIntentEventSafely(
      "channel_songbook_categories_edit_dialog_opened",
      () => ({
        ...getListContextProperties(),
        ...getCategorySummary(category, "category"),
        ...getCategoryPositionProperties(category),
        dialog_source: "row_action",
      })
    );
  }, [getCategoryPositionProperties, getListContextProperties]);

  // 삭제 핸들러
  const handleDeleteClick = useCallback((category: Category) => {
    const getEventProperties = () => ({
      ...getListContextProperties(),
      ...getCategorySummary(category, "category"),
      ...getCategoryPositionProperties(category),
    });
    deleteDialogCloseReasonRef.current = "dismissed";
    deleteDialogClosedCapturedRef.current = false;
    setDeleteCategory({
      id: category.id,
      name: category.name,
    });
    captureIntentEventSafely(
      "channel_songbook_categories_delete_clicked",
      getEventProperties
    );
    captureIntentEventSafely(
      "channel_songbook_categories_delete_dialog_opened",
      getEventProperties
    );
  }, [getCategoryPositionProperties, getListContextProperties]);

  const handleRowSelectionChange = useCallback(
    (
      updater:
        | RowSelectionState
        | ((old: RowSelectionState) => RowSelectionState)
    ) => {
      setRowSelection((previous) => {
        const next =
          typeof updater === "function" ? updater(previous) : updater;
        const previousIds = getSelectedCategoryIds(previous);
        const nextIds = getSelectedCategoryIds(next);

        if (!haveSameIds(previousIds, nextIds)) {
          const selectedVisibleCount = filteredCategories.filter((category) =>
            nextIds.includes(category.id)
          ).length;
          const selectionAction =
            nextIds.length === 0
              ? "cleared"
              : nextIds.length > previousIds.length
                ? "selected"
                : "deselected";

          captureIntentEvent("channel_songbook_categories_selection_changed", {
            ...getListContextProperties(),
            selection_action: selectionAction,
            previous_selected_count: previousIds.length,
            previous_selected_count_bucket: countBucket(previousIds.length),
            next_selected_count: nextIds.length,
            next_selected_count_bucket: countBucket(nextIds.length),
            next_selected_visible_count: selectedVisibleCount,
            next_selected_visible_count_bucket: countBucket(
              selectedVisibleCount
            ),
            all_visible_selected:
              filteredCategories.length > 0 &&
              selectedVisibleCount === filteredCategories.length,
          });

          if (
            filteredCategories.length > 0 &&
            selectedVisibleCount === filteredCategories.length
          ) {
            captureIntentEvent(
              "channel_songbook_categories_selection_all_visible_selected",
              {
                ...getListContextProperties(),
                next_selected_count: nextIds.length,
              }
            );
          }

          if (nextIds.length === 0 && previousIds.length > 0) {
            captureIntentEvent("channel_songbook_categories_selection_cleared", {
              ...getListContextProperties(),
              previous_selected_count: previousIds.length,
            });
          }
        }

        return next;
      });
    },
    [filteredCategories, getListContextProperties]
  );

  const handleSearchFocus = useCallback(() => {
    if (searchFocusCapturedRef.current) return;
    searchFocusCapturedRef.current = true;
    captureIntentEvent("channel_songbook_categories_search_focused", {
      ...getListContextProperties(),
    });
  }, [getListContextProperties]);

  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextQuery = event.target.value;
      const previousQuery = searchQuery;
      const nextFilteredCount = nextQuery.trim()
        ? sortedCategories.filter((category) =>
            category.name.toLowerCase().includes(nextQuery.trim().toLowerCase())
          ).length
        : sortedCategories.length;

      if (!previousQuery.trim() && nextQuery.trim()) {
        captureIntentEvent("channel_songbook_categories_search_started", {
          ...getListContextProperties(),
          next_query_length_bucket: textLengthBucket(nextQuery),
          next_filtered_category_count: nextFilteredCount,
          next_filtered_category_count_bucket: countBucket(nextFilteredCount),
        });
      } else if (previousQuery.trim() && !nextQuery.trim()) {
        captureIntentEvent("channel_songbook_categories_search_cleared", {
          ...getListContextProperties(),
          previous_query_length_bucket: textLengthBucket(previousQuery),
        });
      } else if (nextQuery.trim()) {
        captureIntentEvent("channel_songbook_categories_search_changed", {
          ...getListContextProperties(),
          next_query_length_bucket: textLengthBucket(nextQuery),
          next_filtered_category_count: nextFilteredCount,
          next_filtered_category_count_bucket: countBucket(nextFilteredCount),
        });
      }

      setSearchQuery(nextQuery);
    },
    [getListContextProperties, searchQuery, sortedCategories]
  );

  const handleCreateClick = useCallback(
    (source: "header" | "empty_state") => {
      captureIntentEvent("channel_songbook_categories_create_clicked", {
        ...getListContextProperties(),
        click_source: source,
      });
      handleOpenDialog(undefined, source);
    },
    [getListContextProperties, handleOpenDialog]
  );

  const handlePricingSettingsLinkClick = useCallback(() => {
    captureIntentEvent(
      "channel_songbook_categories_pricing_settings_link_clicked",
      {
        ...getListContextProperties(),
        destination_section: "song_request_settings",
      }
    );
  }, [getListContextProperties]);

  const handleBulkDeleteClick = useCallback(() => {
    bulkDeleteDialogCloseReasonRef.current = "dismissed";
    bulkDeleteDialogClosedCapturedRef.current = false;
    captureIntentEvent("channel_songbook_categories_bulk_delete_clicked", {
      ...getListContextProperties(),
      ...getCategorySelectionSummary(selectedIds, filteredCategories),
    });
    setShowBulkDeleteDialog(true);
    captureIntentEvent("channel_songbook_categories_bulk_delete_dialog_opened", {
      ...getListContextProperties(),
      ...getCategorySelectionSummary(selectedIds, filteredCategories),
    });
  }, [filteredCategories, getListContextProperties, selectedIds]);

  const getCategoryDialogEventProperties = useCallback(
    (values?: CategoryFormData) => {
      const fullCategory = editingCategory
        ? sortedCategories.find((item) => item.id === editingCategory.id)
        : null;

      return {
        ...getListContextProperties(),
        ...(editingCategory
          ? {
              ...getCategorySummary(fullCategory ?? editingCategory, "category"),
              ...(fullCategory ? getCategoryPositionProperties(fullCategory) : {}),
              ...(values ? getCategoryChangeSummary(editingCategory, values) : {}),
            }
          : {}),
        ...(values ? getCategoryFormSummary(values) : {}),
      };
    },
    [
      editingCategory,
      getCategoryPositionProperties,
      getListContextProperties,
      sortedCategories,
    ]
  );

  const handleCategoryFormSubmitClicked = useCallback(
    (values: CategoryFormData) => {
      const eventProperties = getCategoryDialogEventProperties(values);
      if (editingCategory) {
        captureIntentEvent("channel_songbook_categories_edit_save_clicked", {
          ...eventProperties,
        });
        return;
      }

      captureIntentEvent("channel_songbook_categories_create_save_clicked", {
        ...eventProperties,
      });
    },
    [editingCategory, getCategoryDialogEventProperties]
  );

  const handleCategoryFormValidationFailed = useCallback(
    (fields: string[]) => {
      const eventProperties = {
        ...getCategoryDialogEventProperties(),
        validation_field_count: fields.length,
        validation_field_count_bucket: countBucket(fields.length),
        validation_fields: fields,
      };

      if (editingCategory) {
        captureIntentEvent(
          "channel_songbook_categories_edit_save_validation_failed",
          eventProperties
        );
        return;
      }

      captureIntentEvent(
        "channel_songbook_categories_create_save_validation_failed",
        eventProperties
      );
    },
    [editingCategory, getCategoryDialogEventProperties]
  );

  const handleCategoryNameFocus = useCallback(() => {
    if (categoryNameFocusCapturedRef.current) return;
    categoryNameFocusCapturedRef.current = true;
    const eventProperties = getCategoryDialogEventProperties();

    if (editingCategory) {
      captureIntentEvent("channel_songbook_categories_edit_name_focused", {
        ...eventProperties,
      });
      return;
    }

    captureIntentEvent("channel_songbook_categories_create_name_focused", {
      ...eventProperties,
    });
  }, [editingCategory, getCategoryDialogEventProperties]);

  const handleCategoryNameChanged = useCallback(
    (value: string) => {
      const eventProperties = {
        ...getCategoryDialogEventProperties(),
        category_name_length_bucket: textLengthBucket(value),
      };

      if (!categoryNameEditedCapturedRef.current && value.trim().length > 0) {
        categoryNameEditedCapturedRef.current = true;
        if (editingCategory) {
          captureIntentEvent("channel_songbook_categories_edit_name_edited", {
            ...eventProperties,
          });
          return;
        }

        captureIntentEvent("channel_songbook_categories_create_name_edited", {
          ...eventProperties,
        });
      }
    },
    [editingCategory, getCategoryDialogEventProperties]
  );

  const handleCategoryColorTextChanged = useCallback(
    (value: string) => {
      const eventProperties = {
        ...getCategoryDialogEventProperties(),
        category_color_family: colorFamily(value),
        category_color_valid_hex: /^#([0-9a-fA-F]{6})$/.test(value),
      };

      if (editingCategory) {
        captureIntentEvent(
          "channel_songbook_categories_edit_color_text_changed",
          eventProperties
        );
        return;
      }

      captureIntentEvent(
        "channel_songbook_categories_create_color_text_changed",
        eventProperties
      );
    },
    [editingCategory, getCategoryDialogEventProperties]
  );

  const handleCategoryColorPickerChanged = useCallback(
    (value: string) => {
      const eventProperties = {
        ...getCategoryDialogEventProperties(),
        category_color_family: colorFamily(value),
      };

      if (editingCategory) {
        captureIntentEvent(
          "channel_songbook_categories_edit_color_picker_changed",
          eventProperties
        );
        return;
      }

      captureIntentEvent(
        "channel_songbook_categories_create_color_picker_changed",
        eventProperties
      );
    },
    [editingCategory, getCategoryDialogEventProperties]
  );

  const handleCategoryColorPresetSelected = useCallback(
    (color: string, index: number) => {
      const eventProperties = {
        ...getCategoryDialogEventProperties(),
        category_color_family: colorFamily(color),
        preset_index: index,
        preset_position_bucket: countBucket(index + 1),
      };

      if (editingCategory) {
        captureIntentEvent(
          "channel_songbook_categories_edit_color_preset_selected",
          eventProperties
        );
        return;
      }

      captureIntentEvent(
        "channel_songbook_categories_create_color_preset_selected",
        eventProperties
      );
    },
    [editingCategory, getCategoryDialogEventProperties]
  );

  const handleCategoryDirectPriceChanged = useCallback(
    (value: number | null) => {
      const eventProperties = {
        ...getCategoryDialogEventProperties(),
        price_cleared: value == null,
        price_bucket: numericValueBucket(value),
      };

      if (editingCategory) {
        captureIntentEvent(
          "channel_songbook_categories_edit_direct_price_changed",
          eventProperties
        );
        return;
      }

      captureIntentEvent(
        "channel_songbook_categories_create_direct_price_changed",
        eventProperties
      );
    },
    [editingCategory, getCategoryDialogEventProperties]
  );

  const handleCategoryCurrencyPriceChanged = useCallback(
    (index: number, value: number | null) => {
      const eventProperties = {
        ...getCategoryDialogEventProperties(),
        currency_index: index >= 0 ? index : null,
        currency_position_bucket: index >= 0 ? countBucket(index + 1) : "unknown",
        price_cleared: value == null,
        price_bucket: numericValueBucket(value),
      };

      if (editingCategory) {
        captureIntentEvent(
          "channel_songbook_categories_edit_currency_price_changed",
          eventProperties
        );
        return;
      }

      captureIntentEvent(
        "channel_songbook_categories_create_currency_price_changed",
        eventProperties
      );
    },
    [editingCategory, getCategoryDialogEventProperties]
  );

  const handleCategoryDialogCancelClicked = useCallback(() => {
    categoryDialogCloseReasonRef.current = "cancel_clicked";
    const eventProperties = getCategoryDialogEventProperties();

    if (editingCategory) {
      captureIntentEvent("channel_songbook_categories_edit_cancel_clicked", {
        ...eventProperties,
      });
      return;
    }

    captureIntentEvent("channel_songbook_categories_create_cancel_clicked", {
      ...eventProperties,
    });
  }, [editingCategory, getCategoryDialogEventProperties]);

  const captureDeleteDialogClosed = useCallback(
    (reason = deleteDialogCloseReasonRef.current) => {
      if (deleteDialogClosedCapturedRef.current) return;
      deleteDialogClosedCapturedRef.current = true;
      captureIntentEvent("channel_songbook_categories_delete_dialog_closed", {
        ...getDeleteCategoryProperties(deleteCategory),
        close_reason: reason,
      });
    },
    [deleteCategory, getDeleteCategoryProperties]
  );

  const handleDeleteDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      captureDeleteDialogClosed();
      setDeleteCategory(null);
    },
    [captureDeleteDialogClosed]
  );

  const handleDeleteCancelClick = useCallback(() => {
    deleteDialogCloseReasonRef.current = "cancel_clicked";
    captureIntentEvent("channel_songbook_categories_delete_cancel_clicked", {
      ...getDeleteCategoryProperties(deleteCategory),
    });
  }, [deleteCategory, getDeleteCategoryProperties]);

  const captureBulkDeleteDialogClosed = useCallback(
    (reason = bulkDeleteDialogCloseReasonRef.current) => {
      if (bulkDeleteDialogClosedCapturedRef.current) return;
      bulkDeleteDialogClosedCapturedRef.current = true;
      captureIntentEvent(
        "channel_songbook_categories_bulk_delete_dialog_closed",
        {
          ...getListContextProperties(),
          ...getCategorySelectionSummary(selectedIds, filteredCategories),
          close_reason: reason,
        }
      );
    },
    [filteredCategories, getListContextProperties, selectedIds]
  );

  const handleBulkDeleteDialogOpenChange = useCallback(
    (open: boolean) => {
      setShowBulkDeleteDialog(open);
      if (!open) {
        captureBulkDeleteDialogClosed();
      }
    },
    [captureBulkDeleteDialogClosed]
  );

  const handleBulkDeleteCancelClick = useCallback(() => {
    bulkDeleteDialogCloseReasonRef.current = "cancel_clicked";
    captureIntentEvent("channel_songbook_categories_bulk_delete_cancel_clicked", {
      ...getListContextProperties(),
      ...getCategorySelectionSummary(selectedIds, filteredCategories),
    });
  }, [filteredCategories, getListContextProperties, selectedIds]);

  if (error) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="카테고리 관리"
          description="노래를 분류할 카테고리를 관리합니다."
          icon={Tag}
        />
        <InlineError
          message="카테고리 목록을 불러오는데 실패했습니다."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="카테고리 관리"
        description="노래를 분류할 카테고리를 관리합니다."
        icon={Tag}
      >
        <div className="flex items-center gap-2">
          <Button onClick={() => handleCreateClick("header")}>
            <Plus className="w-4 h-4 mr-2" />
            카테고리 추가
          </Button>
        </div>
      </ManagementHeader>

      <div className="mb-4 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        카테고리별 참고 가격은 이 페이지에서 직접 설정할 수 있습니다.
        {!isPricingEnabled && (
          <>
            {" "}
            현재 참고 가격 표시가 비활성화되어 있어 팬에게 표시되지는 않으며,{" "}
            <Link
              href={`/channel/${username}/manage/song-request-settings`}
              className="underline underline-offset-2"
              onClick={handlePricingSettingsLinkClick}
            >
              신청곡 설정
            </Link>
            에서 활성화하면 저장된 가격이 적용됩니다.
          </>
        )}
      </div>

      {/* 툴바: 일괄 삭제 + 검색 */}
      <div className="flex items-center justify-between gap-4 mb-4">
        {selectedIds.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {selectedIds.length}개 선택됨
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBulkDeleteClick}
              disabled={isBulkDeleting}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              일괄 삭제
            </Button>
          </div>
        ) : (
          <div />
        )}
        <Input
          value={searchQuery}
          onFocus={handleSearchFocus}
          onChange={handleSearchChange}
          placeholder="카테고리 검색..."
          className="w-64"
        />
      </div>

      {/* 테이블 */}
      {isLoading ? (
        <div className="rounded-md border">
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </div>
      ) : filteredCategories.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Tag className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2 paperlogy">
              {searchQuery ? "검색 결과가 없습니다" : "카테고리가 없습니다"}
            </h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery
                ? "다른 검색어를 입력해보세요."
                : "첫 번째 카테고리를 추가해보세요."}
            </p>
            <Button onClick={() => handleCreateClick("empty_state")}>
              <Plus className="w-4 h-4 mr-2" />
              카테고리 추가
            </Button>
          </CardContent>
        </Card>
      ) : (
        <CategoriesTable
          data={filteredCategories}
          rowSelection={rowSelection}
          onRowSelectionChange={handleRowSelectionChange}
          onEdit={handleEdit}
          onDelete={handleDeleteClick}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          showPrice
          currencyUnit={currencyUnit}
          currencyConfigs={currencyConfigs}
        />
      )}

      {/* 카테고리 추가/편집 다이얼로그 */}
      <CategoryEditDialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
        }}
        title={editingCategory ? "카테고리 편집" : "카테고리 추가"}
        initialValues={
          editingCategory
            ? {
                name: editingCategory.name,
                color: editingCategory.color,
                price: editingCategory.price,
                currencyPrices: editingCategory.currencyPrices,
              }
            : { name: "", color: DEFAULT_CATEGORY_COLORS[0] }
        }
        showPriceField
        currencyUnit={currencyUnit}
        currencyConfigs={currencyConfigs}
        onNameFocus={handleCategoryNameFocus}
        onNameChanged={handleCategoryNameChanged}
        onColorTextChanged={handleCategoryColorTextChanged}
        onColorPickerChanged={handleCategoryColorPickerChanged}
        onColorPresetSelected={handleCategoryColorPresetSelected}
        onDirectPriceChanged={handleCategoryDirectPriceChanged}
        onCurrencyPriceChanged={handleCategoryCurrencyPriceChanged}
        onCancelClicked={handleCategoryDialogCancelClicked}
        onSubmitClicked={handleCategoryFormSubmitClicked}
        onValidationFailed={handleCategoryFormValidationFailed}
        onSubmit={async (values) => {
          await onSubmit(values);
        }}
      />

      {/* 개별 삭제 확인 다이얼로그 */}
      <AlertDialog
        open={!!deleteCategory}
        onOpenChange={handleDeleteDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="paperlogy">
              카테고리 삭제
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteCategory?.name}</strong> 카테고리를
              삭제하시겠습니까?
              <br />이 작업은 되돌릴 수 없으며, 해당 카테고리에 속한 노래들의
              카테고리 정보가 제거됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeleteCancelClick}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 일괄 삭제 확인 다이얼로그 */}
      <AlertDialog
        open={showBulkDeleteDialog}
        onOpenChange={handleBulkDeleteDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="paperlogy">
              선택한 카테고리 일괄 삭제
            </AlertDialogTitle>
            <AlertDialogDescription>
              총 {selectedIds.length}개 카테고리를 삭제합니다. 이 작업은 되돌릴
              수 없으며, 해당 카테고리에 속한 노래들의 카테고리 정보가
              제거됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleBulkDeleteCancelClick}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={selectedIds.length === 0 || isBulkDeleting}
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isBulkDeleting ? "삭제 중..." : "삭제"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
