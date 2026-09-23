import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getChannelConsoleToken,
  regenerateChannelConsoleToken,
  deleteChannelConsoleToken,
} from "@/meloming/domains/channel/apis/console-token";

export const consoleTokenKeys = {
  all: ["console-token"] as const,
  byChannel: (identifier: string) =>
    [...consoleTokenKeys.all, identifier] as const,
};

export function useConsoleToken(identifier: string, enabled = true) {
  return useQuery({
    queryKey: consoleTokenKeys.byChannel(identifier),
    queryFn: () => getChannelConsoleToken(identifier),
    enabled: !!identifier && enabled,
    staleTime: Infinity,
  });
}

export function useRegenerateConsoleToken(identifier: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => regenerateChannelConsoleToken(identifier),
    onSuccess: (data) => {
      queryClient.setQueryData(consoleTokenKeys.byChannel(identifier), data);
    },
  });
}

export function useDeleteConsoleToken(identifier: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteChannelConsoleToken(identifier),
    onSuccess: () => {
      queryClient.setQueryData(consoleTokenKeys.byChannel(identifier), null);
    },
  });
}
