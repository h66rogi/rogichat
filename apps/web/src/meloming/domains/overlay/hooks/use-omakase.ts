import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adjustConsoleOmakase,
  consumeConsoleOmakase,
  getConsoleOmakaseHistory,
  getConsoleOmakaseStatus,
  getOmakaseSettings,
  setConsoleOmakaseCount,
  updateOmakaseSettings,
  type UpdateOmakaseSettingsDto,
} from "@/meloming/domains/overlay/apis/omakase";

export const omakaseKeys = {
  settings: (channelId: number | null | undefined) => ["omakase", "settings", channelId] as const,
  consoleStatus: ["omakase", "console-status"] as const,
  consoleHistory: ["omakase", "console-history"] as const,
};

const CONSOLE_OMAKASE_STATUS_REFETCH_INTERVAL_MS = 5000;
const CONSOLE_OMAKASE_HISTORY_REFETCH_INTERVAL_MS = 10000;

export function useOmakaseSettings(channelId: number | null | undefined) {
  return useQuery({
    queryKey: omakaseKeys.settings(channelId),
    queryFn: () => getOmakaseSettings(channelId as number),
    enabled: typeof channelId === "number",
  });
}

export function useUpdateOmakaseSettings(channelId: number | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateOmakaseSettingsDto) =>
      updateOmakaseSettings(channelId as number, dto),
    onSuccess: (data) => {
      queryClient.setQueryData(omakaseKeys.settings(channelId), data);
      queryClient.setQueryData(omakaseKeys.consoleStatus, data);
    },
  });
}
export function useConsoleOmakaseStatus(enabled = true) {
  return useQuery({
    queryKey: omakaseKeys.consoleStatus,
    queryFn: getConsoleOmakaseStatus,
    enabled,
    refetchInterval: enabled ? CONSOLE_OMAKASE_STATUS_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function useConsoleOmakaseHistory(enabled = true) {
  return useQuery({
    queryKey: omakaseKeys.consoleHistory,
    queryFn: () => getConsoleOmakaseHistory(50),
    enabled,
    refetchInterval: enabled ? CONSOLE_OMAKASE_HISTORY_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function useAdjustConsoleOmakase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: adjustConsoleOmakase,
    onSuccess: (data) => {
      queryClient.setQueryData(omakaseKeys.consoleStatus, data);
      queryClient.invalidateQueries({ queryKey: omakaseKeys.consoleHistory });
    },
  });
}

export function useSetConsoleOmakaseCount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setConsoleOmakaseCount,
    onSuccess: (data) => {
      queryClient.setQueryData(omakaseKeys.consoleStatus, data);
      queryClient.invalidateQueries({ queryKey: omakaseKeys.consoleHistory });
    },
  });
}

export function useConsumeConsoleOmakase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: consumeConsoleOmakase,
    onSuccess: (data) => {
      queryClient.setQueryData(omakaseKeys.consoleStatus, data.status);
      queryClient.invalidateQueries({ queryKey: omakaseKeys.consoleHistory });
    },
  });
}
