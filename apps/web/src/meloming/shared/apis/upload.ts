import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  PostUploadImageRequestBody,
  PostUploadImageResponse,
  PostUploadFileRequestBody,
  PostUploadFileResponse,
} from "@/meloming/shared/types/upload";

/**
 * POST /upload/image
 */
export async function postUploadImage(
  body: PostUploadImageRequestBody
): Promise<PostUploadImageResponse> {
  const formData = new FormData();
  formData.append("image", body.image);

  const response = await apiClient.post<PostUploadImageResponse>(
    "/upload/image",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      withCredentials: true,
    }
  );

  return response.data;
}

/**
 * POST /upload/file
 */
export async function postUploadFile(
  body: PostUploadFileRequestBody
): Promise<PostUploadFileResponse> {
  const formData = new FormData();
  formData.append("file", body.file);

  const response = await apiClient.post<PostUploadFileResponse>(
    "/upload/file",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      withCredentials: true,
    }
  );

  return response.data;
}
