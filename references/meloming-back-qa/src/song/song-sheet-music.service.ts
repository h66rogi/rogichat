import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SheetMusicType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SheetMusicUploadService,
  SheetMusicUploadResult,
} from '../upload/sheet-music-upload.service';
import { UploadService } from '../upload/upload.service';
import { SongCacheService } from './song-cache.service';

// Phase 2: 곡당 슬롯 캡. 가요 일반 4-5페이지 + 사진 여유 고려 10장. 초과 시 400.
export const SHEET_MUSIC_PER_SONG_CAP = 10;

export interface SheetMusicSlot {
  id: number;
  url: string;
  type: SheetMusicType;
  fileName: string | null;
  fileSize: number | null;
  sortOrder: number;
}

/**
 * Round 2 C1/C2/C6 — channel-scoped, atomic sheet music upload + upsert.
 *
 * This service replaces the split upload-then-PATCH flow (POST /upload/sheet-music
 * followed by PATCH /songs/channel/:identifier/:songId with sheetMusicUrl)
 * with a single channel-scoped endpoint whose service layer:
 *   1. Verifies the song belongs to the channel (authorization + safety)
 *   2. Uploads via SheetMusicUploadService (S3 + MIME/magic validation)
 *   3. Replaces the SongSheetMusic row inside a single transaction
 *   4. Invalidates caches on success only (not on upload-then-DB-fail)
 *
 * Why this shape:
 * - C1: controller uses ChannelPermissionGuard('content'), so matriculation
 *   from "any logged-in user" → "channel manager/owner" is enforced up front.
 * - C2: the URL is produced internally by SheetMusicUploadService — clients
 *   can no longer submit an arbitrary external URL as sheetMusicUrl.
 * - C6: upload+DB replace is one atomic unit. Title/category changes belong
 *   to the PATCH endpoint and are independent; there is no more partial-fail
 *   window between title-update and sheet-music-update.
 *
 * SongSheetMusic.songId is @unique (Round 1 C3), so deleteMany by songId
 * alone is sufficient and race-free.
 */
@Injectable()
export class SongSheetMusicService {
  private readonly logger = new Logger(SongSheetMusicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadService: SheetMusicUploadService,
    private readonly cacheService: SongCacheService,
    private readonly s3Service: UploadService,
  ) {}

  /**
   * Round 4 #5 — best-effort S3 delete. Called after either:
   *   (a) a successful replace/delete to clean up the previous object, or
   *   (b) a compensating rollback when a later step fails after upload.
   *
   * S3 failures must never surface to the caller — the DB state is the
   * source of truth and a stray object only wastes storage, not correctness.
   * We log a warning so ops can run periodic GC sweeps if counts drift.
   */
  private async tryDeleteFromS3(url: string | null | undefined): Promise<void> {
    if (!url) return;
    try {
      await this.s3Service.deleteByUrl(url);
    } catch (err) {
      this.logger.warn(
        `S3 delete failed for ${url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Verify the song exists in the channel. Throws NotFoundException with
   * a deliberately generic message so an attacker cannot probe song IDs
   * across other channels.
   */
  private async assertSongInChannel(
    songId: number,
    channelId: number,
  ): Promise<void> {
    const song = await this.prisma.song.findFirst({
      where: { id: songId, channelId },
      select: { id: true },
    });
    if (!song) {
      throw new NotFoundException({
        code: 'song_not_found_in_channel',
        message: 'Song not found in the given channel.',
      });
    }
  }

  /**
   * Upload file to S3 then replace the SongSheetMusic row atomically.
   *
   * Returns the canonical shape of the new sheet music row (url + type +
   * fileName + fileSize), i.e. the same shape the old SheetMusicUploadService
   * returned. This keeps the response minimal and client-friendly.
   *
   * S3 lifecycle (Round 4 #5):
   *   - happy path: upload → DB swap → delete the PREVIOUS object → return.
   *     The prior sheet music URL is read inside the transaction so we can't
   *     race with a concurrent replace.
   *   - DB tx fails after upload: compensate by deleting the just-uploaded
   *     object so it doesn't linger as a ghost.
   *   - Compensation is best-effort. DB correctness wins over S3 tidiness;
   *     a stray object is a warning, not a 5xx.
   */
  async replaceSheetMusic(input: {
    songId: number;
    channelId: number;
    file: {
      buffer: Buffer;
      mime: string;
      fileName: string;
      fileSize: number;
    };
  }): Promise<SheetMusicUploadResult> {
    await this.assertSongInChannel(input.songId, input.channelId);

    // Upload first (can fail with 400 on MIME/magic mismatch; no DB change yet).
    const uploadResult = await this.uploadService.upload({
      buffer: input.file.buffer,
      mime: input.file.mime,
      fileName: input.file.fileName,
      fileSize: input.file.fileSize,
    });

    // Phase 2: replace 의미 = "곡의 모든 슬롯을 1개로 갈아끼움" (legacy 단일
    // contract 호환). Phase 2A 동안 frontend 의 기존 단일 슬롯 흐름이 그대로
    // 작동하도록 유지. 이전엔 @unique 가 race 방지 했으나 unique 제거 후엔
    // application-level 트랜잭션 + deleteMany 가 그 역할을 한다 (트랜잭션 안에
    // 다른 동시 INSERT 가 들어와도 마지막 commit 만 살아남음).
    //
    // 이 endpoint 가 그대로 살아 있는 이유: frontend Phase 2B 마이그레이션 전엔
    // SheetMusicSection 이 새 array 흐름을 모르므로 legacy POST 가 곧 "유일
    // 슬롯" 의미를 유지해야 회귀 없이 안전.
    let previousUrls: string[] = [];
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.songSheetMusic.findMany({
          where: { songId: input.songId },
          select: { url: true },
        });
        previousUrls = existing.map((r) => r.url);

        await tx.songSheetMusic.deleteMany({
          where: { songId: input.songId },
        });
        await tx.songSheetMusic.create({
          data: {
            songId: input.songId,
            url: uploadResult.url,
            type: uploadResult.type,
            fileName: uploadResult.fileName,
            fileSize: uploadResult.fileSize,
            sortOrder: 0,
            isPrimary: true,
          },
        });
      });
    } catch (err) {
      // Round 4 #5 — compensate: the DB swap failed after S3 upload, so the
      // newly-uploaded object is now an orphan. Delete it so we don't leak.
      await this.tryDeleteFromS3(uploadResult.url);
      throw err;
    }

    // Tx committed. Clean up the previous objects (best effort) and the
    // channel caches, but never let cache or S3 failures mask the successful
    // write. The successor to the old URLs is now canonical.
    for (const u of previousUrls) {
      if (u !== uploadResult.url) {
        await this.tryDeleteFromS3(u);
      }
    }

    try {
      await this.cacheService.clearChannelSongCaches(input.channelId);
    } catch {
      // best-effort
    }

    return uploadResult;
  }

  /**
   * Delete the SongSheetMusic row for this song (if any). Idempotent: the
   * endpoint returns deleted=true regardless of whether a row existed.
   *
   * Round 4 #5 — also best-effort delete the S3 object, so we don't leak
   * storage when a user removes their sheet music.
   */
  async deleteSheetMusic(input: {
    songId: number;
    channelId: number;
  }): Promise<{ deleted: boolean }> {
    await this.assertSongInChannel(input.songId, input.channelId);

    const existing = await this.prisma.songSheetMusic.findFirst({
      where: { songId: input.songId },
      select: { url: true },
    });

    await this.prisma.songSheetMusic.deleteMany({
      where: { songId: input.songId },
    });

    if (existing?.url) {
      await this.tryDeleteFromS3(existing.url);
    }

    try {
      await this.cacheService.clearChannelSongCaches(input.channelId);
    } catch {
      // best-effort
    }

    return { deleted: true };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Phase 2 — multi-slot APIs
  // ────────────────────────────────────────────────────────────────────────

  /**
   * 곡의 모든 슬롯을 sortOrder 오름차순으로 반환. 같은 sortOrder 인 row 끼리는
   * createdAt → id 로 안정 정렬 (마이그레이션 직후 기존 row 가 sortOrder=0 한
   * 묶음일 수 있어 안전판).
   */
  async listSheetMusic(songId: number): Promise<SheetMusicSlot[]> {
    const rows = await this.prisma.songSheetMusic.findMany({
      where: { songId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        url: true,
        type: true,
        fileName: true,
        fileSize: true,
        sortOrder: true,
      },
    });
    return rows;
  }

  /**
   * Append a new slot to the song. Phase 2 의 핵심 동작:
   *   - 곡당 최대 SHEET_MUSIC_PER_SONG_CAP (10) 장 enforce.
   *   - MUSICXML 은 단일 강제 — 기존 MUSICXML 슬롯이 있으면 replace (S3 cleanup
   *     포함). PDF/Image 와 다중 슬롯 정책이 다른 이유: MusicXML 자체가 다중
   *     마디 표현이라 한 곡당 1 데이터로 충분, 다중 슬롯은 단순 noise.
   *   - sortOrder = 기존 max + 1 (트랜잭션 안에서 measure → insert 로 race 방지).
   *   - sortOrder == 0 (첫 슬롯) 이 새로 들어가면 isPrimary=true, 그 외 false.
   *
   * Returns the newly created slot (full shape including id/sortOrder).
   */
  async addSheetMusic(input: {
    songId: number;
    channelId: number;
    file: {
      buffer: Buffer;
      mime: string;
      fileName: string;
      fileSize: number;
    };
  }): Promise<SheetMusicSlot> {
    await this.assertSongInChannel(input.songId, input.channelId);

    // Cap pre-check (race-tolerant — 트랜잭션 안에서 다시 검증). 빠른 거부.
    const preCount = await this.prisma.songSheetMusic.count({
      where: { songId: input.songId },
    });
    if (preCount >= SHEET_MUSIC_PER_SONG_CAP) {
      throw new BadRequestException({
        code: 'sheet_music_capacity_exceeded',
        message: `곡당 악보 슬롯은 최대 ${SHEET_MUSIC_PER_SONG_CAP}개까지 등록할 수 있습니다.`,
      });
    }

    const uploadResult = await this.uploadService.upload({
      buffer: input.file.buffer,
      mime: input.file.mime,
      fileName: input.file.fileName,
      fileSize: input.file.fileSize,
    });

    let createdSlot: SheetMusicSlot | null = null;
    let replacedMusicXmlUrls: string[] = [];
    try {
      await this.prisma.$transaction(async (tx) => {
        // 트랜잭션 안에서 capacity 재검증 + max sortOrder 계산
        const existing = await tx.songSheetMusic.findMany({
          where: { songId: input.songId },
          select: {
            id: true,
            url: true,
            type: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'desc' },
        });
        if (existing.length >= SHEET_MUSIC_PER_SONG_CAP) {
          throw new BadRequestException({
            code: 'sheet_music_capacity_exceeded',
            message: `곡당 악보 슬롯은 최대 ${SHEET_MUSIC_PER_SONG_CAP}개까지 등록할 수 있습니다.`,
          });
        }

        // MUSICXML 단일 강제 — 기존 MUSICXML row 모두 삭제하고 자리에 새로 넣는다.
        if (uploadResult.type === SheetMusicType.MUSICXML) {
          const oldMusicXml = existing.filter(
            (r) => r.type === SheetMusicType.MUSICXML,
          );
          replacedMusicXmlUrls = oldMusicXml.map((r) => r.url);
          if (oldMusicXml.length > 0) {
            await tx.songSheetMusic.deleteMany({
              where: { id: { in: oldMusicXml.map((r) => r.id) } },
            });
          }
        }

        const remaining = existing.filter(
          (r) =>
            !(
              uploadResult.type === SheetMusicType.MUSICXML &&
              r.type === SheetMusicType.MUSICXML
            ),
        );
        const nextSortOrder = remaining.length
          ? Math.max(...remaining.map((r) => r.sortOrder)) + 1
          : 0;

        const created = await tx.songSheetMusic.create({
          data: {
            songId: input.songId,
            url: uploadResult.url,
            type: uploadResult.type,
            fileName: uploadResult.fileName,
            fileSize: uploadResult.fileSize,
            sortOrder: nextSortOrder,
            isPrimary: nextSortOrder === 0,
          },
          select: {
            id: true,
            url: true,
            type: true,
            fileName: true,
            fileSize: true,
            sortOrder: true,
          },
        });
        createdSlot = created;
      });
    } catch (err) {
      // S3 ghost cleanup
      await this.tryDeleteFromS3(uploadResult.url);
      throw err;
    }

    // best-effort: 교체된 MUSICXML 의 옛 S3 객체 정리
    for (const u of replacedMusicXmlUrls) {
      if (u !== uploadResult.url) {
        await this.tryDeleteFromS3(u);
      }
    }

    try {
      await this.cacheService.clearChannelSongCaches(input.channelId);
    } catch {
      // best-effort
    }

    if (!createdSlot) {
      // Should be unreachable — tx commit 후 createdSlot 항상 설정.
      throw new Error('sheet music slot was not created');
    }
    return createdSlot;
  }

  /**
   * Delete a single slot by id. The slot must belong to a song in the given
   * channel — we check both (sheetMusicId in song, song in channel) so a
   * cross-channel id can't be deleted by a different manager.
   *
   * 삭제 후 sortOrder 는 남은 슬롯 그대로 유지 (gap 허용). 사용자가 명시
   * reorder 하지 않는 한 자동 컴팩션 안 함 — 의도와 다른 자동 변경 위험 회피.
   */
  async deleteSheetMusicById(input: {
    songId: number;
    channelId: number;
    sheetMusicId: number;
  }): Promise<{ deleted: boolean }> {
    await this.assertSongInChannel(input.songId, input.channelId);

    const slot = await this.prisma.songSheetMusic.findFirst({
      where: { id: input.sheetMusicId, songId: input.songId },
      select: { id: true, url: true },
    });
    if (!slot) {
      throw new NotFoundException({
        code: 'sheet_music_slot_not_found',
        message: '해당 악보 슬롯을 찾을 수 없습니다.',
      });
    }

    await this.prisma.songSheetMusic.delete({ where: { id: slot.id } });
    if (slot.url) {
      await this.tryDeleteFromS3(slot.url);
    }

    try {
      await this.cacheService.clearChannelSongCaches(input.channelId);
    } catch {
      // best-effort
    }
    return { deleted: true };
  }

  /**
   * Reorder slots by id. `orderedIds` 는 새 sortOrder 0..N-1 순서. 입력 검증:
   *   - 모든 id 가 해당 songId 소유 슬롯
   *   - 정확히 그 곡의 모든 슬롯 (개수 일치 + 누락 없음)
   * 트랜잭션 안에서 일괄 update.
   */
  async reorderSheetMusic(input: {
    songId: number;
    channelId: number;
    orderedIds: number[];
  }): Promise<SheetMusicSlot[]> {
    await this.assertSongInChannel(input.songId, input.channelId);

    if (
      input.orderedIds.length === 0 ||
      new Set(input.orderedIds).size !== input.orderedIds.length
    ) {
      throw new BadRequestException({
        code: 'sheet_music_reorder_invalid',
        message: 'orderedIds 가 비어 있거나 중복이 있습니다.',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.songSheetMusic.findMany({
        where: { songId: input.songId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((r) => r.id));
      if (
        existing.length !== input.orderedIds.length ||
        input.orderedIds.some((id) => !existingIds.has(id))
      ) {
        throw new ForbiddenException({
          code: 'sheet_music_reorder_set_mismatch',
          message: '슬롯 집합이 일치하지 않습니다.',
        });
      }

      // 일괄 update — sortOrder 0..N-1, isPrimary = (sortOrder === 0).
      // 임시로 큰 음수 sortOrder 로 옮긴 뒤 최종값으로 다시 set 하면 unique
      // 필요 없는 환경이라도 안전. (현재는 sortOrder 에 unique 없음.)
      await Promise.all(
        input.orderedIds.map((id, idx) =>
          tx.songSheetMusic.update({
            where: { id },
            data: { sortOrder: idx, isPrimary: idx === 0 },
          }),
        ),
      );

      return tx.songSheetMusic.findMany({
        where: { songId: input.songId },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          url: true,
          type: true,
          fileName: true,
          fileSize: true,
          sortOrder: true,
        },
      });
    });

    try {
      await this.cacheService.clearChannelSongCaches(input.channelId);
    } catch {
      // best-effort
    }
    return result;
  }
}
