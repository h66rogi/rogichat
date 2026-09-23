export interface PostUploadImageRequestBody {
  image: File;
}

export interface PostUploadImageResponse {
  imageUrl: string;
  fileName: string;
}

export interface PostUploadFileRequestBody {
  file: File;
}

export interface PostUploadFileResponse {
  fileUrl: string;
  fileName: string;
}
