"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import type { ChangeEvent } from "react";
import { useParams } from "next/navigation";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { useUserArtists } from "@/meloming/domains/channel/hooks/use-artists";
import { useArtistsManagement } from "@/meloming/domains/channel/hooks/use-artists-management";
import { Plus, User, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/meloming/shared/components/ui/button";
import { InlineError } from "@/meloming/shared/components/common/error-boundary";
import { Input } from "@/meloming/shared/components/ui/input";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import type { Artist } from "@/meloming/domains/channel/types/artist";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/meloming/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/meloming/shared/components/ui/form";
import { useForm } from "react-hook-form";
import { ManagementHeader } from "../management-header";
import type { RowSelectionState } from "@tanstack/react-table";

import { ArtistsTable } from "./artists-table";
import {
  countBucket,
  getApiErrorStatus,
  getArtistChangeSummary,
  getArtistFormSummary,
  getArtistListSummary,
  getArtistSelectionSummary,
  getArtistSummary,
  getErrorName,
  textLengthBucket,
} from "../songbook-analytics";

function getSelectedArtistIds(selection: RowSelectionState): number[] {
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

export function ArtistsManagementV2() {
  const { user } = useParams();
  const userParam = Array.isArray(user) ? user[0] : user;
  const username = userParam || "";

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingArtist, setEditingArtist] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [deleteArtist, setDeleteArtist] = useState<{
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
  const artistDialogCloseReasonRef = useRef("dismissed");
  const artistNameFocusCapturedRef = useRef(false);
  const artistNameEditedCapturedRef = useRef(false);
  const deleteDialogCloseReasonRef = useRef("dismissed");
  const deleteDialogClosedCapturedRef = useRef(false);
  const bulkDeleteDialogCloseReasonRef = useRef("dismissed");
  const bulkDeleteDialogClosedCapturedRef = useRef(false);

  // 공개 유저 정보에서 채널 ID를 얻어 관리 API에 사용
  const { data: publicUser } = useChannel(username);
  const channelId = publicUser?.id ?? 0;

  const { data: artists, isLoading, error, refetch } = useUserArtists(username);

  const {
    createArtist,
    updateArtist,
    deleteArtist: deleteArtistMutation,
  } = useArtistsManagement(channelId, { enabled: channelId > 0 });

  const form = useForm<{ name: string }>({
    defaultValues: { name: "" },
  });

  const artistList = useMemo(() => (artists ?? []) as Artist[], [artists]);

  // 검색 필터링
  const filteredArtists = useMemo(() => {
    const list = artistList;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => a.name.toLowerCase().includes(q));
  }, [artistList, searchQuery]);

  // 선택된 ID 계산
  const selectedIds = useMemo(() => {
    return getSelectedArtistIds(rowSelection);
  }, [rowSelection]);

  const getListContextProperties = useCallback(
    () => ({
      channel_id: channelId || null,
      channel_username_present: Boolean(username),
      search_active: searchQuery.trim().length > 0,
      search_query_length_bucket: textLengthBucket(searchQuery),
      filtered_artist_count: filteredArtists.length,
      filtered_artist_count_bucket: countBucket(filteredArtists.length),
      ...getArtistListSummary(artistList),
      ...getArtistSelectionSummary(selectedIds, filteredArtists),
    }),
    [
      artistList,
      channelId,
      filteredArtists,
      searchQuery,
      selectedIds,
      username,
    ]
  );

  const getArtistPositionProperties = useCallback(
    (artist: Artist) => {
      const listIndex = artistList.findIndex((item) => item.id === artist.id);
      const filteredIndex = filteredArtists.findIndex(
        (item) => item.id === artist.id
      );

      return {
        artist_list_index: listIndex >= 0 ? listIndex : null,
        artist_list_position_bucket:
          listIndex >= 0 ? countBucket(listIndex + 1) : "unknown",
        artist_filtered_index: filteredIndex >= 0 ? filteredIndex : null,
        artist_filtered_position_bucket:
          filteredIndex >= 0 ? countBucket(filteredIndex + 1) : "unknown",
      };
    },
    [artistList, filteredArtists]
  );

  const getDeleteArtistProperties = useCallback(
    (artist: { id: number; name: string } | null | undefined) => {
      const fullArtist = artist
        ? artistList.find((item) => item.id === artist.id)
        : null;

      return {
        ...getListContextProperties(),
        ...getArtistSummary(fullArtist, "artist"),
        ...(fullArtist ? getArtistPositionProperties(fullArtist) : {}),
      };
    },
    [artistList, getArtistPositionProperties, getListContextProperties]
  );

  useEffect(() => {
    if (!channelId || pageViewCapturedRef.current) return;
    pageViewCapturedRef.current = true;
    captureIntentEvent("channel_songbook_artists_viewed", {
      ...getListContextProperties(),
      list_ready: Boolean(artists),
    });
  }, [artists, channelId, getListContextProperties]);

  useEffect(() => {
    if (!error) return;
    captureIntentEvent("channel_songbook_artists_list_load_failed", {
      channel_id: channelId || null,
      channel_username_present: Boolean(username),
      error_name: getErrorName(error),
      error_status: getApiErrorStatus(error),
    });
  }, [channelId, error, username]);

  useEffect(() => {
    if (!artists) return;

    const signature = artistList
      .map((artist) =>
        [artist.id, artist.songCount ?? 0, artist.createdAt ?? "unset"].join(":")
      )
      .join("|");
    if (listLoadSignatureRef.current === signature) return;
    listLoadSignatureRef.current = signature;

    const summary = {
      channel_id: channelId || null,
      channel_username_present: Boolean(username),
      ...getArtistListSummary(artistList),
    };

    captureIntentEvent("channel_songbook_artists_list_loaded", summary);
    if (artistList.length === 0) {
      captureIntentEvent("channel_songbook_artists_empty_state_viewed", {
        ...summary,
        empty_state_source: "initial_list",
      });
    }
  }, [artistList, artists, channelId, username]);

  useEffect(() => {
    const trimmedQuery = searchQuery.trim();
    if (
      !trimmedQuery ||
      artistList.length === 0 ||
      filteredArtists.length > 0
    ) {
      return;
    }

    const signature = `${textLengthBucket(trimmedQuery)}:${artistList.length}`;
    if (searchEmptySignatureRef.current === signature) return;
    searchEmptySignatureRef.current = signature;
    captureIntentEvent("channel_songbook_artists_search_empty_state_viewed", {
      ...getListContextProperties(),
      empty_state_source: "search",
    });
  }, [
    artistList.length,
    filteredArtists.length,
    getListContextProperties,
    searchQuery,
  ]);

  const handleOpenDialog = (
    artist?: { id: number; name: string },
    source = "header"
  ) => {
    artistDialogCloseReasonRef.current = "dismissed";
    artistNameFocusCapturedRef.current = false;
    artistNameEditedCapturedRef.current = false;

    if (artist) {
      setEditingArtist({ id: artist.id, name: artist.name });
      form.reset({ name: artist.name });
      const fullArtist = artistList.find((item) => item.id === artist.id);
      captureIntentEvent("channel_songbook_artists_edit_dialog_opened", {
        ...getListContextProperties(),
        ...getArtistSummary(fullArtist ?? artist, "artist"),
        ...(fullArtist ? getArtistPositionProperties(fullArtist) : {}),
        dialog_source: source,
      });
    } else {
      setEditingArtist(null);
      form.reset({ name: "" });
      captureIntentEvent("channel_songbook_artists_create_dialog_opened", {
        ...getListContextProperties(),
        dialog_source: source,
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = (reason = artistDialogCloseReasonRef.current) => {
    const fullArtist = editingArtist
      ? artistList.find((item) => item.id === editingArtist.id)
      : null;
    const eventProperties = {
      ...getListContextProperties(),
      ...(editingArtist
        ? {
            ...getArtistSummary(fullArtist ?? editingArtist, "artist"),
            ...(fullArtist ? getArtistPositionProperties(fullArtist) : {}),
          }
        : {}),
      close_reason: reason,
    };

    if (editingArtist) {
      captureIntentEvent(
        "channel_songbook_artists_edit_dialog_closed",
        eventProperties
      );
    } else {
      captureIntentEvent(
        "channel_songbook_artists_create_dialog_closed",
        eventProperties
      );
    }
    setIsDialogOpen(false);
    setEditingArtist(null);
    form.reset({ name: "" });
  };

  const onSubmit = async (data: { name: string }) => {
    const trimmedName = data.name.trim();
    const fullArtist = editingArtist
      ? artistList.find((item) => item.id === editingArtist.id)
      : null;
    const eventProperties = {
      ...getListContextProperties(),
      ...(editingArtist
        ? {
            ...getArtistSummary(fullArtist ?? editingArtist, "artist"),
            ...(fullArtist ? getArtistPositionProperties(fullArtist) : {}),
            ...getArtistChangeSummary(editingArtist, { name: trimmedName }),
          }
        : {}),
      ...getArtistFormSummary({ name: trimmedName }),
    };

    if (editingArtist) {
      captureIntentEvent("channel_songbook_artists_edit_save_submitted", {
        ...eventProperties,
      });
    } else {
      captureIntentEvent("channel_songbook_artists_create_save_submitted", {
        ...eventProperties,
      });
    }

    if (!channelId) {
      if (editingArtist) {
        captureIntentEvent(
          "channel_songbook_artists_edit_save_blocked_channel_missing",
          eventProperties
        );
      } else {
        captureIntentEvent(
          "channel_songbook_artists_create_save_blocked_channel_missing",
          eventProperties
        );
      }
      return;
    }
    if (!trimmedName) {
      if (editingArtist) {
        captureIntentEvent(
          "channel_songbook_artists_edit_save_blocked_empty_name",
          eventProperties
        );
      } else {
        captureIntentEvent(
          "channel_songbook_artists_create_save_blocked_empty_name",
          eventProperties
        );
      }
      return;
    }

    try {
      if (editingArtist) {
        await updateArtist.mutateAsync({
          artistsId: editingArtist.id,
          body: { name: trimmedName },
        });
        captureIntentEvent("channel_songbook_artists_edit_save_succeeded", {
          ...eventProperties,
        });
      } else {
        await createArtist.mutateAsync({ name: trimmedName });
        captureIntentEvent("channel_songbook_artists_create_save_succeeded", {
          ...eventProperties,
        });
      }
      artistDialogCloseReasonRef.current = "saved";
      handleCloseDialog("saved");
      await refetch();
    } catch (error) {
      console.error("아티스트 저장 실패:", error);
      if (editingArtist) {
        captureIntentEvent("channel_songbook_artists_edit_save_failed", {
          ...eventProperties,
          error_name: getErrorName(error),
          error_status: getApiErrorStatus(error),
        });
      } else {
        captureIntentEvent("channel_songbook_artists_create_save_failed", {
          ...eventProperties,
          error_name: getErrorName(error),
          error_status: getApiErrorStatus(error),
        });
      }
    }
  };

  // 개별 삭제
  const handleDelete = async () => {
    const eventProperties = getDeleteArtistProperties(deleteArtist);
    deleteDialogCloseReasonRef.current = "confirm_clicked";
    captureIntentEvent("channel_songbook_artists_delete_confirm_clicked", {
      ...eventProperties,
    });
    captureIntentEvent("channel_songbook_artists_delete_submitted", {
      ...eventProperties,
    });

    if (!deleteArtist) {
      captureIntentEvent("channel_songbook_artists_delete_blocked_missing_target", {
        ...eventProperties,
      });
      return;
    }

    try {
      if (!channelId) {
        captureIntentEvent("channel_songbook_artists_delete_blocked_channel_missing", {
          ...eventProperties,
        });
        return;
      }
      await deleteArtistMutation.mutateAsync({
        artistsId: deleteArtist.id,
      });
      captureIntentEvent("channel_songbook_artists_delete_succeeded", {
        ...eventProperties,
      });
      deleteDialogCloseReasonRef.current = "succeeded";
      captureDeleteDialogClosed("succeeded");
      // 선택 상태에서 제거
      setRowSelection((prev) => {
        const next = { ...prev };
        delete next[String(deleteArtist.id)];
        return next;
      });
      setDeleteArtist(null);
      await refetch();
    } catch (error) {
      console.error("아티스트 삭제 실패:", error);
      captureIntentEvent("channel_songbook_artists_delete_failed", {
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
      ...getArtistSelectionSummary(selectedIds, filteredArtists),
    };

    bulkDeleteDialogCloseReasonRef.current = "confirm_clicked";
    captureIntentEvent("channel_songbook_artists_bulk_delete_confirm_clicked", {
      ...eventProperties,
    });
    captureIntentEvent("channel_songbook_artists_bulk_delete_submitted", {
      ...eventProperties,
    });

    if (!channelId) {
      captureIntentEvent(
        "channel_songbook_artists_bulk_delete_blocked_channel_missing",
        eventProperties
      );
      return;
    }
    if (selectedIds.length === 0) {
      captureIntentEvent("channel_songbook_artists_bulk_delete_blocked_empty", {
        ...eventProperties,
      });
      return;
    }

    try {
      setIsBulkDeleting(true);
      // 순차적으로 삭제
      for (const id of selectedIds) {
        await deleteArtistMutation.mutateAsync({ artistsId: id });
      }
      toast.success("일괄 삭제 완료", {
        description: `${selectedIds.length}개 아티스트가 삭제되었습니다.`,
      });
      captureIntentEvent("channel_songbook_artists_bulk_delete_succeeded", {
        ...eventProperties,
      });
      bulkDeleteDialogCloseReasonRef.current = "succeeded";
      setRowSelection({});
      await refetch();
    } catch (error) {
      console.error("일괄 삭제 실패:", error);
      bulkDeleteDialogCloseReasonRef.current = "failed";
      captureIntentEvent("channel_songbook_artists_bulk_delete_failed", {
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
  const handleEdit = useCallback((artist: Artist) => {
    captureIntentEvent("channel_songbook_artists_edit_clicked", {
      ...getListContextProperties(),
      ...getArtistSummary(artist, "artist"),
      ...getArtistPositionProperties(artist),
    });
    setEditingArtist({
      id: artist.id,
      name: artist.name,
    });
    artistDialogCloseReasonRef.current = "dismissed";
    artistNameFocusCapturedRef.current = false;
    artistNameEditedCapturedRef.current = false;
    form.reset({ name: artist.name });
    setIsDialogOpen(true);
    captureIntentEvent("channel_songbook_artists_edit_dialog_opened", {
      ...getListContextProperties(),
      ...getArtistSummary(artist, "artist"),
      ...getArtistPositionProperties(artist),
      dialog_source: "row_action",
    });
  }, [form, getArtistPositionProperties, getListContextProperties]);

  // 삭제 핸들러
  const handleDeleteClick = useCallback((artist: Artist) => {
    const eventProperties = {
      ...getListContextProperties(),
      ...getArtistSummary(artist, "artist"),
      ...getArtistPositionProperties(artist),
    };
    captureIntentEvent("channel_songbook_artists_delete_clicked", {
      ...eventProperties,
    });
    deleteDialogCloseReasonRef.current = "dismissed";
    deleteDialogClosedCapturedRef.current = false;
    setDeleteArtist({
      id: artist.id,
      name: artist.name,
    });
    captureIntentEvent("channel_songbook_artists_delete_dialog_opened", {
      ...eventProperties,
    });
  }, [getArtistPositionProperties, getListContextProperties]);

  const handleRowSelectionChange = useCallback(
    (
      updater:
        | RowSelectionState
        | ((old: RowSelectionState) => RowSelectionState)
    ) => {
      setRowSelection((previous) => {
        const next =
          typeof updater === "function" ? updater(previous) : updater;
        const previousIds = getSelectedArtistIds(previous);
        const nextIds = getSelectedArtistIds(next);

        if (!haveSameIds(previousIds, nextIds)) {
          const selectedVisibleCount = filteredArtists.filter((artist) =>
            nextIds.includes(artist.id)
          ).length;
          const selectionAction =
            nextIds.length === 0
              ? "cleared"
              : nextIds.length > previousIds.length
                ? "selected"
                : "deselected";

          captureIntentEvent("channel_songbook_artists_selection_changed", {
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
              filteredArtists.length > 0 &&
              selectedVisibleCount === filteredArtists.length,
          });

          if (
            filteredArtists.length > 0 &&
            selectedVisibleCount === filteredArtists.length
          ) {
            captureIntentEvent(
              "channel_songbook_artists_selection_all_visible_selected",
              {
                ...getListContextProperties(),
                next_selected_count: nextIds.length,
              }
            );
          }

          if (nextIds.length === 0 && previousIds.length > 0) {
            captureIntentEvent("channel_songbook_artists_selection_cleared", {
              ...getListContextProperties(),
              previous_selected_count: previousIds.length,
            });
          }
        }

        return next;
      });
    },
    [filteredArtists, getListContextProperties]
  );

  const handleSearchFocus = useCallback(() => {
    if (searchFocusCapturedRef.current) return;
    searchFocusCapturedRef.current = true;
    captureIntentEvent("channel_songbook_artists_search_focused", {
      ...getListContextProperties(),
    });
  }, [getListContextProperties]);

  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextQuery = event.target.value;
      const previousQuery = searchQuery;
      const nextFilteredCount = nextQuery.trim()
        ? artistList.filter((artist) =>
            artist.name.toLowerCase().includes(nextQuery.trim().toLowerCase())
          ).length
        : artistList.length;

      if (!previousQuery.trim() && nextQuery.trim()) {
        captureIntentEvent("channel_songbook_artists_search_started", {
          ...getListContextProperties(),
          next_query_length_bucket: textLengthBucket(nextQuery),
          next_filtered_artist_count: nextFilteredCount,
          next_filtered_artist_count_bucket: countBucket(nextFilteredCount),
        });
      } else if (previousQuery.trim() && !nextQuery.trim()) {
        captureIntentEvent("channel_songbook_artists_search_cleared", {
          ...getListContextProperties(),
          previous_query_length_bucket: textLengthBucket(previousQuery),
        });
      } else if (nextQuery.trim()) {
        captureIntentEvent("channel_songbook_artists_search_changed", {
          ...getListContextProperties(),
          next_query_length_bucket: textLengthBucket(nextQuery),
          next_filtered_artist_count: nextFilteredCount,
          next_filtered_artist_count_bucket: countBucket(nextFilteredCount),
        });
      }

      setSearchQuery(nextQuery);
    },
    [artistList, getListContextProperties, searchQuery]
  );

  const handleCreateClick = useCallback(
    (source: "header" | "empty_state") => {
      captureIntentEvent("channel_songbook_artists_create_clicked", {
        ...getListContextProperties(),
        click_source: source,
      });
      handleOpenDialog(undefined, source);
    },
    [getListContextProperties, handleOpenDialog]
  );

  const getArtistDialogEventProperties = useCallback(
    (values?: { name: string }) => {
      const fullArtist = editingArtist
        ? artistList.find((item) => item.id === editingArtist.id)
        : null;

      return {
        ...getListContextProperties(),
        ...(editingArtist
          ? {
              ...getArtistSummary(fullArtist ?? editingArtist, "artist"),
              ...(fullArtist ? getArtistPositionProperties(fullArtist) : {}),
              ...(values ? getArtistChangeSummary(editingArtist, values) : {}),
            }
          : {}),
        ...(values ? getArtistFormSummary(values) : {}),
      };
    },
    [
      artistList,
      editingArtist,
      getArtistPositionProperties,
      getListContextProperties,
    ]
  );

  const handleArtistFormSubmitClicked = useCallback(
    (values: { name: string }) => {
      const eventProperties = getArtistDialogEventProperties({
        name: values.name.trim(),
      });
      if (editingArtist) {
        captureIntentEvent("channel_songbook_artists_edit_save_clicked", {
          ...eventProperties,
        });
        return;
      }

      captureIntentEvent("channel_songbook_artists_create_save_clicked", {
        ...eventProperties,
      });
    },
    [editingArtist, getArtistDialogEventProperties]
  );

  const handleArtistFormValidationFailed = useCallback(
    (fields: string[]) => {
      const eventProperties = {
        ...getArtistDialogEventProperties(),
        validation_field_count: fields.length,
        validation_field_count_bucket: countBucket(fields.length),
        validation_fields: fields,
      };

      if (editingArtist) {
        captureIntentEvent(
          "channel_songbook_artists_edit_save_validation_failed",
          eventProperties
        );
        return;
      }

      captureIntentEvent(
        "channel_songbook_artists_create_save_validation_failed",
        eventProperties
      );
    },
    [editingArtist, getArtistDialogEventProperties]
  );

  const handleArtistNameFocus = useCallback(() => {
    if (artistNameFocusCapturedRef.current) return;
    artistNameFocusCapturedRef.current = true;
    const eventProperties = getArtistDialogEventProperties();

    if (editingArtist) {
      captureIntentEvent("channel_songbook_artists_edit_name_focused", {
        ...eventProperties,
      });
      return;
    }

    captureIntentEvent("channel_songbook_artists_create_name_focused", {
      ...eventProperties,
    });
  }, [editingArtist, getArtistDialogEventProperties]);

  const handleArtistNameChanged = useCallback(
    (value: string) => {
      const eventProperties = {
        ...getArtistDialogEventProperties(),
        artist_name_length_bucket: textLengthBucket(value),
      };

      if (!artistNameEditedCapturedRef.current && value.trim().length > 0) {
        artistNameEditedCapturedRef.current = true;
        if (editingArtist) {
          captureIntentEvent("channel_songbook_artists_edit_name_edited", {
            ...eventProperties,
          });
          return;
        }

        captureIntentEvent("channel_songbook_artists_create_name_edited", {
          ...eventProperties,
        });
      }
    },
    [editingArtist, getArtistDialogEventProperties]
  );

  const handleArtistDialogCancelClicked = useCallback(() => {
    artistDialogCloseReasonRef.current = "cancel_clicked";
    const eventProperties = getArtistDialogEventProperties();

    if (editingArtist) {
      captureIntentEvent("channel_songbook_artists_edit_cancel_clicked", {
        ...eventProperties,
      });
      return;
    }

    captureIntentEvent("channel_songbook_artists_create_cancel_clicked", {
      ...eventProperties,
    });
  }, [editingArtist, getArtistDialogEventProperties]);

  const captureDeleteDialogClosed = useCallback(
    (reason = deleteDialogCloseReasonRef.current) => {
      if (deleteDialogClosedCapturedRef.current) return;
      deleteDialogClosedCapturedRef.current = true;
      captureIntentEvent("channel_songbook_artists_delete_dialog_closed", {
        ...getDeleteArtistProperties(deleteArtist),
        close_reason: reason,
      });
    },
    [deleteArtist, getDeleteArtistProperties]
  );

  const handleDeleteDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      captureDeleteDialogClosed();
      setDeleteArtist(null);
    },
    [captureDeleteDialogClosed]
  );

  const handleDeleteCancelClick = useCallback(() => {
    deleteDialogCloseReasonRef.current = "cancel_clicked";
    captureIntentEvent("channel_songbook_artists_delete_cancel_clicked", {
      ...getDeleteArtistProperties(deleteArtist),
    });
  }, [deleteArtist, getDeleteArtistProperties]);

  const captureBulkDeleteDialogClosed = useCallback(
    (reason = bulkDeleteDialogCloseReasonRef.current) => {
      if (bulkDeleteDialogClosedCapturedRef.current) return;
      bulkDeleteDialogClosedCapturedRef.current = true;
      captureIntentEvent("channel_songbook_artists_bulk_delete_dialog_closed", {
        ...getListContextProperties(),
        ...getArtistSelectionSummary(selectedIds, filteredArtists),
        close_reason: reason,
      });
    },
    [filteredArtists, getListContextProperties, selectedIds]
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

  const handleBulkDeleteClick = useCallback(() => {
    bulkDeleteDialogCloseReasonRef.current = "dismissed";
    bulkDeleteDialogClosedCapturedRef.current = false;
    captureIntentEvent("channel_songbook_artists_bulk_delete_clicked", {
      ...getListContextProperties(),
      ...getArtistSelectionSummary(selectedIds, filteredArtists),
    });
    setShowBulkDeleteDialog(true);
    captureIntentEvent("channel_songbook_artists_bulk_delete_dialog_opened", {
      ...getListContextProperties(),
      ...getArtistSelectionSummary(selectedIds, filteredArtists),
    });
  }, [filteredArtists, getListContextProperties, selectedIds]);

  const handleBulkDeleteCancelClick = useCallback(() => {
    bulkDeleteDialogCloseReasonRef.current = "cancel_clicked";
    captureIntentEvent("channel_songbook_artists_bulk_delete_cancel_clicked", {
      ...getListContextProperties(),
      ...getArtistSelectionSummary(selectedIds, filteredArtists),
    });
  }, [filteredArtists, getListContextProperties, selectedIds]);

  if (error) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="아티스트 관리"
          description="아티스트를 추가, 수정, 삭제할 수 있습니다."
          icon={User}
        />
        <InlineError
          message="아티스트 목록을 불러오는데 실패했습니다."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="아티스트 관리"
        description="아티스트를 추가, 수정, 삭제할 수 있습니다."
        icon={User}
      >
        <div className="flex items-center gap-2">
          <Button onClick={() => handleCreateClick("header")}>
            <Plus className="w-4 h-4 mr-2" />
            아티스트 추가
          </Button>
        </div>
      </ManagementHeader>

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
          placeholder="아티스트 검색..."
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
      ) : filteredArtists.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <User className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2 paperlogy">
              {searchQuery ? "검색 결과가 없습니다" : "아티스트가 없습니다"}
            </h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery
                ? "다른 검색어를 입력해보세요."
                : "첫 번째 아티스트를 추가해보세요."}
            </p>
            <Button onClick={() => handleCreateClick("empty_state")}>
              <Plus className="w-4 h-4 mr-2" />
              아티스트 추가
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ArtistsTable
          data={filteredArtists}
          rowSelection={rowSelection}
          onRowSelectionChange={handleRowSelectionChange}
          onEdit={handleEdit}
          onDelete={handleDeleteClick}
        />
      )}

      {/* 아티스트 추가/편집 다이얼로그 */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="paperlogy">
              {editingArtist ? "아티스트 수정" : "아티스트 추가"}
            </DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(
                async (values) => {
                  handleArtistFormSubmitClicked(values);
                  await onSubmit(values);
                },
                (errors) =>
                  handleArtistFormValidationFailed(Object.keys(errors))
              )}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                rules={{
                  required: "아티스트 이름을 입력해주세요.",
                  minLength: {
                    value: 1,
                    message: "최소 1글자 이상이어야 합니다.",
                  },
                  maxLength: {
                    value: 50,
                    message: "최대 50글자까지 입력할 수 있습니다.",
                  },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>아티스트 이름</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="예: 아이유, 방탄소년단"
                        onFocus={handleArtistNameFocus}
                        onChange={(event) => {
                          field.onChange(event);
                          handleArtistNameChanged(event.target.value);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handleArtistDialogCancelClicked();
                    handleCloseDialog("cancel_clicked");
                  }}
                >
                  취소
                </Button>
                <Button type="submit">{editingArtist ? "수정" : "추가"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* 개별 삭제 확인 다이얼로그 */}
      <AlertDialog
        open={!!deleteArtist}
        onOpenChange={handleDeleteDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="paperlogy">
              아티스트 삭제
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteArtist?.name}</strong> 아티스트를
              삭제하시겠습니까?
              <br />이 작업은 되돌릴 수 없으며, 해당 아티스트의 노래도 함께
              삭제됩니다.
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
              선택한 아티스트 일괄 삭제
            </AlertDialogTitle>
            <AlertDialogDescription>
              총 {selectedIds.length}개 아티스트를 삭제합니다. 이 작업은 되돌릴
              수 없으며, 해당 아티스트의 노래도 함께 삭제됩니다.
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
