import { useMutation } from "@tanstack/react-query";
import { postUploadImage } from "@/meloming/shared/apis/upload";
import type {
  PostUploadImageRequestBody,
  PostUploadImageResponse,
} from "@/meloming/shared/types/upload";

export function useUploadImage(options?: {
  onSuccess?: (data: PostUploadImageResponse) => void;
  onError?: (error: Error) => void;
}) {
  return useMutation({
    mutationFn: (body: PostUploadImageRequestBody) => postUploadImage(body),
    onSuccess: (data) => {
      options?.onSuccess?.(data);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });
}
