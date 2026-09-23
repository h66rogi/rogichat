import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelService } from '../channel/channel.service';
import { UploadService } from '../upload/upload.service';
import { SongCacheService } from './song-cache.service';
import {
  MR_VIDEO_MAX_BYTES,
  MR_VIDEO_PART_CONCURRENCY,
  MR_VIDEO_PART_SIZE_BYTES,
} from './dto/song-mr-video.dto';

const VIDEO_EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'video/mpeg': 'mpeg',
};

@Injectable()
export class SongMrVideoService {
  private readonly logger = new Logger(SongMrVideoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channelService: ChannelService,
    private readonly uploadService: UploadService,
    private readonly cacheService: SongCacheService,
  ) {}

  async initiateMultipart(
    identifier: string,
    songId: number,
    input: { fileName: string; contentType: string; fileSizeBytes: number },
  ) {
    const song = await this.assertSongInChannel(identifier, songId);
    const contentType = this.normalizeVideoContentType(input.contentType);
    this.assertFileSize(input.fileSizeBytes);

    const ext = this.extensionFor(contentType, input.fileName);
    const key = `songs/mr-videos/channel/${song.channelId}/song/${song.id}/${randomUUID()}.${ext}`;
    const upload = await this.uploadService.createMultipartUpload({
      key,
      contentType,
    });

    return {
      ...upload,
      partSizeBytes: MR_VIDEO_PART_SIZE_BYTES,
      maxSizeBytes: MR_VIDEO_MAX_BYTES,
      concurrency: MR_VIDEO_PART_CONCURRENCY,
    };
  }

  async signPart(
    identifier: string,
    songId: number,
    input: { key: string; uploadId: string; partNumber: number },
  ) {
    const song = await this.assertSongInChannel(identifier, songId);
    this.assertKeyForSong(input.key, song.channelId, song.id);
    const url = await this.uploadService.getUploadPartUrl({
      key: input.key,
      uploadId: input.uploadId,
      partNumber: input.partNumber,
      expiresIn: 3600,
    });
    return { partNumber: input.partNumber, url };
  }

  async completeMultipart(
    identifier: string,
    songId: number,
    input: {
      key: string;
      uploadId: string;
      fileSizeBytes: number;
      parts: Array<{ partNumber: number; etag: string }>;
    },
  ) {
    const song = await this.assertSongInChannel(identifier, songId);
    this.assertKeyForSong(input.key, song.channelId, song.id);
    this.assertFileSize(input.fileSizeBytes);
    this.assertParts(input.parts, input.fileSizeBytes);

    const completed = await this.uploadService.completeMultipartUpload({
      key: input.key,
      uploadId: input.uploadId,
      parts: input.parts,
    });

    if (
      completed.fileSizeBytes !== null &&
      completed.fileSizeBytes > MR_VIDEO_MAX_BYTES
    ) {
      await this.uploadService.deleteByKey(input.key).catch(() => undefined);
      throw new BadRequestException('MR 영상은 최대 5GB까지 업로드할 수 있습니다.');
    }

    let updated: { id: number; mrVideoUrl: string | null; mrVideoKey: string | null };
    try {
      updated = await this.prisma.song.update({
        where: { id: song.id },
        data: {
          mrVideoUrl: completed.url,
          mrVideoKey: input.key,
        },
        select: {
          id: true,
          mrVideoUrl: true,
          mrVideoKey: true,
        },
      });
    } catch (err) {
      await this.uploadService.deleteByKey(input.key).catch(() => undefined);
      throw err;
    }

    if (song.mrVideoKey && song.mrVideoKey !== input.key) {
      await this.uploadService.deleteByKey(song.mrVideoKey).catch((err) => {
        this.logger.warn(
          `Previous MR video delete failed key=${song.mrVideoKey}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    await this.cacheService.clearChannelSongCaches(song.channelId);
    return { ...updated, fileSizeBytes: completed.fileSizeBytes };
  }

  async abortMultipart(
    identifier: string,
    songId: number,
    input: { key: string; uploadId: string },
  ) {
    const song = await this.assertSongInChannel(identifier, songId);
    this.assertKeyForSong(input.key, song.channelId, song.id);
    await this.uploadService.abortMultipartUpload(input);
    return { aborted: true };
  }

  async deleteMrVideo(identifier: string, songId: number) {
    const song = await this.assertSongInChannel(identifier, songId);
    const updated = await this.prisma.song.update({
      where: { id: song.id },
      data: { mrVideoUrl: null, mrVideoKey: null },
      select: { id: true, mrVideoUrl: true, mrVideoKey: true },
    });

    if (song.mrVideoKey) {
      await this.uploadService.deleteByKey(song.mrVideoKey).catch((err) => {
        this.logger.warn(
          `MR video delete failed key=${song.mrVideoKey}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    await this.cacheService.clearChannelSongCaches(song.channelId);
    return updated;
  }

  private async assertSongInChannel(identifier: string, songId: number) {
    const channel = await this.channelService.findByIdentifier(identifier);
    const song = await this.prisma.song.findUnique({
      where: { id: songId },
      select: {
        id: true,
        channelId: true,
        mrVideoKey: true,
      },
    });
    if (!song) {
      throw new NotFoundException('노래를 찾을 수 없습니다.');
    }
    if (song.channelId !== channel.id) {
      throw new ForbiddenException('이 노래에 대한 수정 권한이 없습니다.');
    }
    return song;
  }

  private normalizeVideoContentType(contentType: string): string {
    const normalized = contentType.trim().toLowerCase();
    if (!normalized.startsWith('video/')) {
      throw new BadRequestException('영상 파일만 업로드할 수 있습니다.');
    }
    return normalized;
  }

  private assertFileSize(fileSizeBytes: number) {
    if (fileSizeBytes <= 0 || fileSizeBytes > MR_VIDEO_MAX_BYTES) {
      throw new BadRequestException('MR 영상은 최대 5GB까지 업로드할 수 있습니다.');
    }
  }

  private assertParts(
    parts: Array<{ partNumber: number; etag: string }>,
    fileSizeBytes: number,
  ) {
    const expectedPartCount = Math.ceil(fileSizeBytes / MR_VIDEO_PART_SIZE_BYTES);
    if (parts.length !== expectedPartCount) {
      throw new BadRequestException(
        `multipart part 개수가 맞지 않습니다. expected=${expectedPartCount}, actual=${parts.length}`,
      );
    }
    const seen = new Set<number>();
    for (const part of parts) {
      if (seen.has(part.partNumber)) {
        throw new BadRequestException('multipart partNumber가 중복되었습니다.');
      }
      seen.add(part.partNumber);
    }
    for (let partNumber = 1; partNumber <= expectedPartCount; partNumber += 1) {
      if (!seen.has(partNumber)) {
        throw new BadRequestException(`multipart partNumber=${partNumber}가 누락되었습니다.`);
      }
    }
  }

  private assertKeyForSong(key: string, channelId: number, songId: number) {
    const prefix = `songs/mr-videos/channel/${channelId}/song/${songId}/`;
    if (!key.startsWith(prefix) || key.includes('..')) {
      throw new BadRequestException('유효하지 않은 MR 영상 업로드 key입니다.');
    }
  }

  private extensionFor(contentType: string, fileName: string): string {
    const fromMime = VIDEO_EXT_BY_MIME[contentType];
    if (fromMime) return fromMime;
    const ext = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
    return ext?.slice(0, 12) || 'mp4';
  }
}
