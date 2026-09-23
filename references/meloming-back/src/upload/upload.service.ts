import { BadRequestException, Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { resolveUploadObjectStorageRuntimeConfig } from '../common/object-storage/object-storage.config';
import { v4 as uuidv4 } from 'uuid';
import {
  UploadResponseDto,
  UploadFileResponseDto,
} from './dto/upload.response.dto';

export type UploadedObjectResult = UploadFileResponseDto & {
  fileKey: string;
};

export type ReviewImageUploadResult = {
  fileKey: string;
  previewUrl: string;
  expiresIn: number;
};

const REVIEW_IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const REVIEW_IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

@Injectable()
export class UploadService {
  private s3Client: S3Client;
  private bucketName: string;
  private cdnUrl: string;

  constructor(private configService: ConfigService) {
    const storage = resolveUploadObjectStorageRuntimeConfig(this.configService);
    this.s3Client = new S3Client(storage.client);
    this.bucketName = storage.bucketName;
    this.cdnUrl = storage.publicBaseUrl;
  }

  async uploadImage(file: Express.Multer.File): Promise<UploadResponseDto> {
    // 오늘 날짜 (YYYYMMDD 형식)
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // UUID + 확장자
    const fileExtension = file.originalname.split('.').pop() || 'jpg';
    const fileName = `${uuidv4()}.${fileExtension}`;
    const s3Key = `${today}/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await this.s3Client.send(command);

    // CDN URL이 설정되어 있으면 CDN URL 사용, 없으면 S3 직접 URL 사용
    const imageUrl = this.cdnUrl
      ? `${this.cdnUrl}/${s3Key}`
      : `https://${this.bucketName}.s3.${this.configService.get('AWS_REGION')}.amazonaws.com/${s3Key}`;

    return {
      fileKey: s3Key,
      imageUrl,
      fileName,
    };
  }

  async uploadPrivateReviewImage(
    userId: number,
    file: Express.Multer.File,
  ): Promise<ReviewImageUploadResult> {
    const extension = this.reviewImageExtension(file.mimetype);
    if (!extension) {
      throw new BadRequestException(
        'JPEG, PNG, GIF, WebP 이미지만 첨부할 수 있어요',
      );
    }
    if (
      typeof file.size !== 'number' ||
      file.size <= 0 ||
      file.size > REVIEW_IMAGE_MAX_SIZE_BYTES
    ) {
      throw new BadRequestException(
        '이미지는 장당 최대 10MB까지 첨부할 수 있어요',
      );
    }

    const fileKey = `reviews/${userId}/${uuidv4()}.${extension}`;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'private, max-age=300',
      }),
    );
    const { url: previewUrl, expiresIn } = await this.getPresignedFileUrl({
      key: fileKey,
      expiresIn: 5 * 60,
    });
    return { fileKey, previewUrl, expiresIn };
  }

  async assertPrivateReviewImage(
    userId: number,
    fileKey: string,
  ): Promise<void> {
    if (!this.isOwnedReviewImageKey(userId, fileKey)) {
      throw new BadRequestException('검증되지 않은 리뷰 이미지예요');
    }

    let metadata: HeadObjectCommandOutput;
    try {
      metadata = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: fileKey,
        }),
      );
    } catch {
      throw new BadRequestException('리뷰 이미지를 찾을 수 없어요');
    }

    if (
      !metadata.ContentType ||
      !REVIEW_IMAGE_CONTENT_TYPES.has(metadata.ContentType.toLowerCase())
    ) {
      throw new BadRequestException('지원하지 않는 리뷰 이미지 형식이에요');
    }
    if (
      typeof metadata.ContentLength !== 'number' ||
      metadata.ContentLength <= 0 ||
      metadata.ContentLength > REVIEW_IMAGE_MAX_SIZE_BYTES
    ) {
      throw new BadRequestException(
        '이미지는 장당 최대 10MB까지 첨부할 수 있어요',
      );
    }
  }

  async uploadFile(file: Express.Multer.File): Promise<UploadFileResponseDto> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const fileExtension = file.originalname.split('.').pop() || 'bin';
    const fileName = `${uuidv4()}.${fileExtension}`;
    const s3Key = `${today}/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await this.s3Client.send(command);

    const fileUrl = this.cdnUrl
      ? `${this.cdnUrl}/${s3Key}`
      : `https://${this.bucketName}.s3.${this.configService.get('AWS_REGION')}.amazonaws.com/${s3Key}`;

    return {
      fileKey: s3Key,
      fileUrl,
      fileName,
    };
  }

  /**
   * Uploads a raw buffer to S3 without requiring a fake `Express.Multer.File`.
   * Mirrors `uploadFile`'s key layout (`YYYYMMDD/<uuid>.<ext>`) and, when set,
   * the `folder` is prefixed before the date segment (e.g.
   * `<folder>/YYYYMMDD/<uuid>.<ext>`).
   *
   * The extension is taken from the last `.`-segment of `originalname`.
   * If absent, falls back to `bin`.
   */
  async uploadBuffer(args: {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
    folder?: string;
  }): Promise<UploadFileResponseDto> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    // `originalname` is attacker-influenced (comes from multipart upload) but
    // we only use it here as an extension hint. The actual S3 key is
    // `[folder/]YYYYMMDD/<uuid>.<ext>` — the filename portion is a
    // server-generated UUID, so path traversal via originalname is not
    // possible. Worst case a user picks a weird extension, which bloats the
    // ext segment but can't escape the prefix.
    const fileExtension = args.originalname.split('.').pop() || 'bin';
    const fileName = `${uuidv4()}.${fileExtension}`;
    const folderPrefix = args.folder
      ? `${args.folder.replace(/\/$/, '')}/`
      : '';
    const s3Key = `${folderPrefix}${today}/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      Body: args.buffer,
      ContentType: args.mimetype,
    });

    await this.s3Client.send(command);

    const fileUrl = this.cdnUrl
      ? `${this.cdnUrl}/${s3Key}`
      : `https://${this.bucketName}.s3.${this.configService.get('AWS_REGION')}.amazonaws.com/${s3Key}`;

    return {
      fileKey: s3Key,
      fileUrl,
      fileName,
    };
  }

  async uploadFileFromPath(args: {
    path: string;
    mimetype: string;
    originalname: string;
    folder?: string;
  }): Promise<UploadedObjectResult> {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileExtension = this.getSafeExtension(args.originalname);
    const fileName = `${uuidv4()}.${fileExtension}`;
    const folderPrefix = args.folder
      ? `${args.folder.replace(/\/$/, '')}/`
      : '';
    const s3Key = `${folderPrefix}${today}/${fileName}`;
    const fileStat = await stat(args.path);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: createReadStream(args.path),
        ContentLength: fileStat.size,
        ContentType: args.mimetype,
      }),
    );

    const fileUrl = this.cdnUrl
      ? `${this.cdnUrl}/${s3Key}`
      : `https://${this.bucketName}.s3.${this.configService.get('AWS_REGION')}.amazonaws.com/${s3Key}`;

    return {
      fileUrl,
      fileName,
      fileKey: s3Key,
    };
  }

  async uploadEmoticonImage(input: {
    channelId: number;
    file: { buffer: Buffer; mimetype: string; originalname: string };
    shortcode: string;
    emoticonId: number;
  }): Promise<{ url: string; key: string }> {
    const ext =
      input.file.mimetype === 'image/gif'
        ? 'gif'
        : input.file.mimetype === 'image/webp'
          ? 'webp'
          : 'png';
    const key = `emoticons/channel/${input.channelId}/${input.emoticonId}-${input.shortcode}.${ext}`;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: input.file.buffer,
        ContentType: input.file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    const url = this.cdnUrl
      ? `${this.cdnUrl.replace(/\/$/, '')}/${key}`
      : `https://${this.bucketName}.s3.${this.configService.get('AWS_REGION', 'ap-northeast-2')}.amazonaws.com/${key}`;
    return { url, key };
  }

  async deleteByUrl(url: string): Promise<void> {
    const key = this.extractKeyFromUrl(url);
    if (!key) return;
    await this.deleteByKey(key);
  }

  async deleteByKey(key: string): Promise<void> {
    if (!key) return;
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
    );
  }

  async deletePrivateReviewImage(
    userId: number,
    fileKey: string,
  ): Promise<void> {
    if (!this.isOwnedReviewImageKey(userId, fileKey)) {
      throw new BadRequestException('검증되지 않은 리뷰 이미지예요');
    }
    await this.deleteByKey(fileKey);
  }

  async getPresignedFileUrl(args: {
    key: string;
    expiresIn?: number;
    disposition?: 'attachment';
    filename?: string;
  }): Promise<{ url: string; expiresIn: number }> {
    const expiresIn = args.expiresIn ?? 60 * 60;
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: args.key,
      ...(args.disposition === 'attachment'
        ? {
            ResponseContentDisposition: `attachment; filename="${this.sanitizeFilename(args.filename ?? 'clip.mp4')}"`,
          }
        : {}),
    });
    const url = await getSignedUrl(this.s3Client, command, { expiresIn });
    return { url, expiresIn };
  }

  async createMultipartUpload(args: {
    key: string;
    contentType: string;
  }): Promise<{ key: string; uploadId: string }> {
    const result = await this.s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: args.key,
        ContentType: args.contentType,
      }),
    );
    if (!result.UploadId) {
      throw new Error(`S3 did not return UploadId for ${args.key}`);
    }
    return { key: args.key, uploadId: result.UploadId };
  }

  async getUploadPartUrl(args: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresIn?: number;
  }): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucketName,
      Key: args.key,
      UploadId: args.uploadId,
      PartNumber: args.partNumber,
    });
    return getSignedUrl(this.s3Client, command, {
      expiresIn: args.expiresIn ?? 3600,
    });
  }

  async completeMultipartUpload(args: {
    key: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }): Promise<{ fileSizeBytes: number | null; url: string }> {
    await this.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: args.key,
        UploadId: args.uploadId,
        MultipartUpload: {
          Parts: args.parts
            .slice()
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
        },
      }),
    );

    const head = await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: args.key,
      }),
    );

    return {
      fileSizeBytes: head.ContentLength ?? null,
      url: this.getPublicUrlForKey(args.key),
    };
  }

  async abortMultipartUpload(args: {
    key: string;
    uploadId: string;
  }): Promise<void> {
    await this.s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: args.key,
        UploadId: args.uploadId,
      }),
    );
  }

  private sanitizeFilename(filename: string): string {
    const safe = filename.replace(/[\\/:*?"<>|]/g, ' ').trim();
    return safe.length > 0 ? safe.slice(0, 140) : 'clip.mp4';
  }

  getPublicUrlForKey(key: string): string {
    return this.cdnUrl
      ? `${this.cdnUrl.replace(/\/$/, '')}/${key}`
      : `https://${this.bucketName}.s3.${this.configService.get('AWS_REGION', 'ap-northeast-2')}.amazonaws.com/${key}`;
  }

  async uploadClipVideoFromPath(args: {
    channelId: number;
    path: string;
    mimetype: string;
    originalname: string;
  }): Promise<UploadedObjectResult> {
    return this.uploadFileFromPath({
      path: args.path,
      mimetype: args.mimetype,
      originalname: args.originalname,
      folder: `clips/uploads/channel/${args.channelId}`,
    });
  }

  async uploadClipThumbnailFromPath(args: {
    channelId: number;
    path: string;
    mimetype: string;
    originalname: string;
  }): Promise<UploadedObjectResult> {
    return this.uploadFileFromPath({
      path: args.path,
      mimetype: args.mimetype,
      originalname: args.originalname,
      folder: `clips/uploads/channel/${args.channelId}/thumbnails`,
    });
  }

  private extractKeyFromUrl(url: string): string | null {
    try {
      const u = new URL(url);
      const pathname = u.pathname.startsWith('/')
        ? u.pathname.slice(1)
        : u.pathname;
      return pathname || null;
    } catch {
      return null;
    }
  }

  private getSafeExtension(originalname: string): string {
    return (
      originalname
        .split('.')
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 12) || 'bin'
    );
  }

  private reviewImageExtension(mimetype: string): string | null {
    switch (mimetype.toLowerCase()) {
      case 'image/jpeg':
      case 'image/jpg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/gif':
        return 'gif';
      case 'image/webp':
        return 'webp';
      default:
        return null;
    }
  }

  private isOwnedReviewImageKey(userId: number, fileKey: string): boolean {
    return new RegExp(
      `^reviews/${userId}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:jpg|jpeg|png|gif|webp)$`,
      'i',
    ).test(fileKey);
  }
}
