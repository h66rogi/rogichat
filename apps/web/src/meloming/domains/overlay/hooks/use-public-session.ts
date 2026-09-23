import { useQuery } from "@tanstack/react-query";
import {
  getPublicActiveSession,
  type PublicLiveSessionResponse,
} from "@/meloming/domains/overlay/apis/public-session";

export const publicSessionKeys = {
  active: (identifier: string) => ["song-live", "public", "active", identifier] as const,
};

export function usePublicActiveSession(
  identifier: string | undefined,
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  const interval = options?.refetchInterval;

  return useQuery<PublicLiveSessionResponse>({
    queryKey: identifier ? publicSessionKeys.active(identifier) : ["song-live", "public", "active", "unknown"],
    queryFn: () => getPublicActiveSession(identifier!),
    enabled: Boolean(identifier) && (options?.enabled ?? true),
    staleTime: 30_000,
    refetchInterval: interval
      ? (query) => {
          if (query.state.fetchStatus === "idle" && query.state.error) {
            return interval * 4; // backoff: 30s→120s on error, auto-recovers on success
          }
          return interval;
        }
      : undefined,
  });
}
