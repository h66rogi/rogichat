import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  getChannelIdentifier,
  getChannelIdentifierPermission,
  updateChannelScheduleNotice,
  getChannelGuestbookSettings,
  updateChannelGuestbookSettings,
  getChannelFeatureSettings,
  updateChannelFeatureSettings,
  getChannelMusicbookSettings,
  updateChannelMusicbookSettings,
  copyDifficultyToProficiency,
  getChannelGlobalProfile,
  type ChannelGlobalProfile,
} from "@/meloming/domains/channel/apis/channels";
import type {
  Channel,
  GetChannelIdentifierPermissionResponse,
} from "@/meloming/domains/channel/types/channel";
import type {
  ChannelFeatureSettings,
  ChannelFeatureSettingsUpdate,
  ChannelMusicbookSettings,
  ChannelMusicbookSettingsUpdate,
  CopyDifficultyToProficiencyResponse,
} from "@/meloming/domains/channel/types/channel-tab";
import { themeColorAtom } from "@/meloming/domains/channel/atoms/channel-atom";

// Query keys
export const channelKeys = {
  all: ["channel"] as const,
  identifier: (identifier: string) =>
    [...channelKeys.all, "identifier", identifier] as const,
  identifierPermission: (identifier: string) =>
    [...channelKeys.all, "identifier", identifier, "permission"] as const,
  guestbookSettings: (identifier: string) =>
    [...channelKeys.all, "identifier", identifier, "guestbook-settings"] as const,
  featureSettings: (identifier: string) =>
    [...channelKeys.all, "identifier", identifier, "feature-settings"] as const,
  musicbookSettings: (identifier: string) =>
    [...channelKeys.all, "identifier", identifier, "musicbook-settings"] as const,
  globalProfile: (channelId: number | undefined) =>
    [...channelKeys.all, "global-profile", channelId ?? -1] as const,
};

/**
 * 특정 채널의 정보를 가져오는 훅
 * @param identifier - 채널 식별자
 * @param options - useQuery 옵션
 */
export function useChannel(
  identifier: string,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
    initialData?: Channel;
  }
): UseQueryResult<Channel, Error> {
  const setThemeColor = useSetAtom(themeColorAtom);

  const query = useQuery({
    queryKey: channelKeys.identifier(identifier),
    queryFn: () => getChannelIdentifier(identifier),
    enabled: !!identifier && (options?.enabled ?? true),
    initialData: options?.initialData,
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.cacheTime ?? 10 * 60 * 1000, // 10분 (구 cacheTime)
  });

  // API 호출 성공 시 테마 색상을 전역 상태에 동기화
  useEffect(() => {
    if (query.data?.themeColor) {
      setThemeColor(query.data.themeColor);
    }
  }, [query.data?.themeColor, setThemeColor]);

  return query;
}

/**
 * 특정 채널의 권한을 가져오는 훅
 * @param identifier - 채널 식별자
 * @param options - useQuery 옵션
 */
export function useChannelPermission(
  identifier: string,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
    initialData?: GetChannelIdentifierPermissionResponse | null;
  }
): UseQueryResult<GetChannelIdentifierPermissionResponse | null, Error> {
  return useQuery({
    queryKey: channelKeys.identifierPermission(identifier),
    queryFn: () => getChannelIdentifierPermission(identifier),
    enabled: !!identifier && (options?.enabled ?? true),
    initialData: options?.initialData,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.cacheTime ?? 10 * 60 * 1000,
  });
}

/**
 * 채널의 일정 공지를 업데이트하는 훅
 */
export function useUpdateChannelScheduleNotice(
  identifier: string
): UseMutationResult<Channel, Error, string | null> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (scheduleNotice: string | null) =>
      updateChannelScheduleNotice(identifier, scheduleNotice),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: channelKeys.identifier(identifier),
      });
    },
  });
}

/**
 * 채널의 방명록 설정을 가져오는 훅
 */
export function useChannelGuestbookSettings(
  identifier: string,
  options?: {
    enabled?: boolean;
  }
): UseQueryResult<{ guestbookEnabled: boolean }, Error> {
  return useQuery({
    queryKey: channelKeys.guestbookSettings(identifier),
    queryFn: () => getChannelGuestbookSettings(identifier),
    enabled: !!identifier && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * 채널의 방명록 설정을 업데이트하는 훅
 */
export function useUpdateChannelGuestbookSettings(
  identifier: string
): UseMutationResult<
  { guestbookEnabled: boolean; message: string },
  Error,
  boolean
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (guestbookEnabled: boolean) =>
      updateChannelGuestbookSettings(identifier, guestbookEnabled),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: channelKeys.guestbookSettings(identifier),
      });
    },
  });
}

/**
 * 채널 공개 메뉴의 기능 노출/이름/순서 설정을 가져오는 훅
 */
export function useChannelFeatureSettings(
  identifier: string,
  options?: {
    enabled?: boolean;
    initialData?: ChannelFeatureSettings;
  }
): UseQueryResult<ChannelFeatureSettings, Error> {
  return useQuery({
    queryKey: channelKeys.featureSettings(identifier),
    queryFn: () => getChannelFeatureSettings(identifier),
    enabled: !!identifier && (options?.enabled ?? true),
    initialData: options?.initialData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * 채널 공개 메뉴의 기능 노출/이름/순서 설정을 업데이트하는 훅
 */
export function useUpdateChannelFeatureSettings(
  identifier: string
): UseMutationResult<
  ChannelFeatureSettings,
  Error,
  ChannelFeatureSettingsUpdate
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: ChannelFeatureSettingsUpdate) =>
      updateChannelFeatureSettings(identifier, settings),
    onSuccess: (data) => {
      queryClient.setQueryData(channelKeys.featureSettings(identifier), data);
      queryClient.invalidateQueries({
        queryKey: channelKeys.featureSettings(identifier),
      });
      queryClient.invalidateQueries({
        queryKey: channelKeys.guestbookSettings(identifier),
      });
    },
  });
}

/**
 * 채널 노래책 표시/필터 설정을 가져오는 훅
 */
export function useChannelMusicbookSettings(
  identifier: string,
  options?: {
    enabled?: boolean;
    initialData?: ChannelMusicbookSettings;
  }
): UseQueryResult<ChannelMusicbookSettings, Error> {
  return useQuery({
    queryKey: channelKeys.musicbookSettings(identifier),
    queryFn: () => getChannelMusicbookSettings(identifier),
    enabled: !!identifier && (options?.enabled ?? true),
    initialData: options?.initialData,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * 채널 노래책 표시/필터 설정을 업데이트하는 훅
 */
export function useUpdateChannelMusicbookSettings(
  identifier: string
): UseMutationResult<
  ChannelMusicbookSettings,
  Error,
  ChannelMusicbookSettingsUpdate
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings) =>
      updateChannelMusicbookSettings(identifier, settings),
    onSuccess: (data) => {
      queryClient.setQueryData(channelKeys.musicbookSettings(identifier), data);
      queryClient.invalidateQueries({
        queryKey: channelKeys.musicbookSettings(identifier),
      });
    },
  });
}

/**
 * 난이도를 숙련도로 일괄 복사하는 훅
 */
export function useCopyDifficultyToProficiency(
  identifier: string
): UseMutationResult<CopyDifficultyToProficiencyResponse, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => copyDifficultyToProficiency(identifier),
    onSuccess: (data) => {
      queryClient.setQueryData(channelKeys.musicbookSettings(identifier), data);
      queryClient.invalidateQueries({
        queryKey: channelKeys.musicbookSettings(identifier),
      });
    },
  });
}

/**
 * 채널의 기존 글로벌 미러 노출 설정을 가져오는 훅
 */
export function useChannelGlobalProfile(
  channelId: number | undefined,
  options?: { enabled?: boolean }
): UseQueryResult<ChannelGlobalProfile, Error> {
  return useQuery({
    queryKey: channelKeys.globalProfile(channelId),
    queryFn: () => getChannelGlobalProfile(channelId as number),
    enabled: !!channelId && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
