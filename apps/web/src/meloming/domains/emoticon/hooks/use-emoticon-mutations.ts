import { useMutation, useQueryClient } from "@tanstack/react-query";
import { softDeleteEmoticon, uploadEmoticon } from "../apis/emoticon";
import type { ChannelEmoticon } from "../types";

/**
 * 이모티콘 업로드 뮤테이션.
 * 성공 시 내 이모티콘 목록 쿼리를 무효화한다.
 */
export function useUploadEmoticon(channelId: number | undefined) {
  const queryClient = useQueryClient();

  return useMutation<ChannelEmoticon, Error, FormData>({
    mutationFn: (form: FormData) => {
      if (!channelId) {
        return Promise.reject(new Error("channelId is required"));
      }
      return uploadEmoticon(channelId, form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-emoticons", channelId] });
    },
  });
}

/**
 * 이모티콘 소프트 삭제 뮤테이션.
 * 성공 시 내 이모티콘 목록 쿼리를 무효화한다.
 */
export function useDeleteEmoticon(channelId: number | undefined) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: (emoticonId: number) => {
      if (!channelId) {
        return Promise.reject(new Error("channelId is required"));
      }
      return softDeleteEmoticon(channelId, emoticonId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-emoticons", channelId] });
      queryClient.invalidateQueries({ queryKey: ["channel-emoticons", channelId] });
    },
  });
}
