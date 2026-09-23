import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getManageSetlists,
  getPublicSetlistDetail,
  getPublicSetlists,
  updateSetlistVisibility,
} from "../apis/setlist";
import type { SetlistVisibility } from "../types/setlist";

const setlistKeys = {
  all: ["setlists"] as const,
  list: (identifier: string, page: number, limit: number) =>
    [...setlistKeys.all, "list", identifier, page, limit] as const,
  detail: (identifier: string, sessionId: number) =>
    [...setlistKeys.all, "detail", identifier, sessionId] as const,
  manage: (identifier: string, page: number, limit: number) =>
    [...setlistKeys.all, "manage", identifier, page, limit] as const,
  manageAll: (identifier: string) =>
    [...setlistKeys.all, "manage", identifier] as const,
};

export function usePublicSetlists(
  identifier: string,
  page: number = 1,
  limit: number = 20,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: setlistKeys.list(identifier, page, limit),
    queryFn: () => getPublicSetlists(identifier, page, limit),
    enabled: enabled && !!identifier,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function usePublicSetlistDetail(
  identifier: string,
  sessionId: number | null,
  enabled: boolean = true
) {
  return useQuery({
    queryKey:
      sessionId !== null
        ? setlistKeys.detail(identifier, sessionId)
        : [...setlistKeys.all, "detail", identifier, "none"],
    queryFn: () => getPublicSetlistDetail(identifier, sessionId as number),
    enabled: enabled && !!identifier && sessionId !== null,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * 채널 owner / canManageContent 매니저용 셋리스트 관리 목록.
 * 공개 목록과 달리 PUBLIC + PRIVATE 모두 포함되며 visibility 필드를 응답에 담는다.
 */
export function useManageSetlists(
  identifier: string,
  page: number = 1,
  limit: number = 20,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: setlistKeys.manage(identifier, page, limit),
    queryFn: () => getManageSetlists(identifier, page, limit),
    enabled: enabled && !!identifier,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * 셋리스트 가시성 토글 mutation. 성공 시 manage / public 목록 + 채널 캘린더 캐시를
 * 모두 invalidate 하여 토글 결과가 셋리스트 페이지와 캘린더에 즉시 반영되도록 한다.
 */
export function useUpdateSetlistVisibility(identifier: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      visibility,
    }: {
      sessionId: number;
      visibility: SetlistVisibility;
    }) => updateSetlistVisibility(identifier, sessionId, visibility),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: setlistKeys.manageAll(identifier),
      });
      queryClient.invalidateQueries({ queryKey: setlistKeys.all });
      // 채널 통합 캘린더는 별도 도메인의 query key (`channel/calendar`) 를 가진다.
      // setlist 변경이 캘린더에 반영되도록 상위 트리를 함께 invalidate.
      queryClient.invalidateQueries({ queryKey: ["channel", "calendar"] });
    },
  });
}
