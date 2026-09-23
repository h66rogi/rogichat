import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { customAlphabet } from 'nanoid';
import { format } from 'date-fns';
import { detectSheetMusicType, SheetMusicType } from './utils/sheet-music-mime';
import { extractMxlToMusicXml, MxlExtractError } from './utils/mxl-extractor';
import {
  buildConfiguredObjectPublicUrl,
  resolveObjectStorageConfig,
  type ObjectStorageConfig,
} from '../common/object-storage/object-storage.config';

const NANOID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const nanoid = customAlphabet(NANOID_ALPHABET, 32);

const MIME_TO_IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface SheetMusicUploadInput {
  buffer: Buffer;
  mime: string;
  fileName: string;
  fileSize: number;
}

export interface SheetMusicUploadResult {
  url: string;
  type: SheetMusicType;
  fileName: string;
  fileSize: number;
}

@Injectable()
export class SheetMusicUploadService {
  private readonly logger = new Logger(SheetMusicUploadService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly storageConfig: ObjectStorageConfig;

  constructor(private readonly config: ConfigService) {
    this.storageConfig = resolveObjectStorageConfig(this.config);
    this.s3 = new S3Client(this.storageConfig.clientConfig);
    this.bucket = this.storageConfig.bucket;
  }

  async upload(input: SheetMusicUploadInput): Promise<SheetMusicUploadResult> {
    const headSlice = input.buffer.subarray(0, 256);
    const detected = detectSheetMusicType(
      input.mime,
      input.fileName,
      headSlice,
    );
    if (!detected) {
      throw new BadRequestException({
        code: 'unsupported_or_mismatched',
        message: 'Unsupported file or MIME/magic mismatch.',
      });
    }

    let bodyToUpload = input.buffer;
    let extension = '';

    if (detected === 'MUSICXML') {
      const lowerMime = input.mime.toLowerCase();
      if (
        input.fileName.toLowerCase().endsWith('.mxl') ||
        lowerMime === 'application/zip'
      ) {
        try {
          bodyToUpload = await extractMxlToMusicXml(input.buffer);
        } catch (e) {
          if (e instanceof MxlExtractError) {
            throw new BadRequestException({
              code: `mxl_${e.reason}`,
              message:
                'Could not safely extract .mxl. Please export as .musicxml from your editor.',
            });
          }
          throw e;
        }
      }
      extension = 'musicxml';
    } else if (detected === 'PDF') {
      extension = 'pdf';
    } else if (detected === 'IMAGE') {
      extension = MIME_TO_IMAGE_EXT[input.mime.toLowerCase()] ?? 'png';
    }

    const date = format(new Date(), 'yyyy-MM-dd');
    const key = `sheet-music/${date}/${nanoid()}.${extension}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bodyToUpload,
        ContentType: this.contentTypeFor(detected, input.mime),
        Metadata: { 'x-robots-tag': 'noindex,nofollow' },
      }),
    );

    return {
      url: buildConfiguredObjectPublicUrl(this.storageConfig, key),
      type: detected,
      fileName: input.fileName,
      fileSize: bodyToUpload.length,
    };
  }

  private contentTypeFor(type: SheetMusicType, originalMime: string): string {
    if (type === 'PDF') return 'application/pdf';
    if (type === 'MUSICXML') return 'application/vnd.recordare.musicxml+xml';
    if (type === 'IMAGE') return originalMime;
    return 'application/octet-stream';
  }
}
