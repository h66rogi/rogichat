import { useMutation } from "@tanstack/react-query";
import { postUploadImage } from "@/meloming/shared/apis/upload";
import type { PostUploadImageResponse } from "@/meloming/shared/types/upload";
import { toast } from "sonner";

interface UseImageUploadOptions {
  onSuccess?: (data: PostUploadImageResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * 이미지 업로드를 위한 hook
 * - 파일 업로드
 * - 에러 핸들링
 * - 로딩 상태 관리
 */
export function useImageUpload(options?: UseImageUploadOptions) {
  const mutation = useMutation({
    mutationFn: async (file: File) => {
      return await postUploadImage({ image: file });
    },
    onSuccess: (data) => {
      toast.success("이미지가 업로드되었습니다");
      options?.onSuccess?.(data);
    },
    onError: (error) => {
      console.error("이미지 업로드 실패:", error);
      toast.error("이미지 업로드에 실패했습니다");
      options?.onError?.(error as Error);
    },
  });

  return {
    uploadImage: mutation.mutateAsync,
    uploadImageSync: mutation.mutate,
    isUploading: mutation.isPending,
    uploadedData: mutation.data,
    error: mutation.error,
    reset: mutation.reset,
  };
}
