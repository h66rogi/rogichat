import { useQuery } from "@tanstack/react-query";
import { getMyEmoticons } from "../apis/emoticon";

/**
 * 스트리머 본인의 이모티콘 목록을 가져오는 훅
 * APPROVED/PENDING/REJECTED 등 모든 상태를 포함한다
 * (공개 목록과 달리 관리 화면 전용)
 */
export function useMyEmoticons(channelId: number | undefined) {
  return useQuery({
    queryKey: ["my-emoticons", channelId],
    queryFn: () => getMyEmoticons(channelId!),
    enabled: !!channelId,
    staleTime: 60 * 1000, // 1 min
  });
}
