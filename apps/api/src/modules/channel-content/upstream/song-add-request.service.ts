// Adapted by copying Meloming a91393b2 src/song/song-add-request.service.ts
// request, approval, moderation, pagination and DTO methods.
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SongAddRequestStatus } from '../../../generated/prisma/client.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { nextChannelContentId } from '../channel-content-id.js';
import { normalizeForSearch } from './search-normalize.js';
import { ChannelMusicbookSettingsService } from './channel-musicbook-settings.service.js';
import { SongHelperService } from './song-helper.service.js';

type SongAddRequestCreateDto = {
  channelId: number; title: string; artistName: string; albumArt?: string;
  karaokeUrl?: string; coverUrl?: string; originalUrl?: string;
  difficulty?: number; proficiency?: number; songKey?: string; bpm?: number;
  lyricsLink?: string; lyricsText?: string; categoryNames?: string[];
};
type SongAddRequestApproveDto = Partial<Omit<SongAddRequestCreateDto, 'channelId'>>;
type SongAddRequestRejectDto = { reason?: string };
type SongAddRequestListQueryDto = { status?: SongAddRequestStatus; cursorId?: number; take?: number };

const songAddRequestSelect = {
  id: true, title: true, artistName: true, albumArt: true, karaokeUrl: true,
  coverUrl: true, originalUrl: true, difficulty: true, proficiency: true,
  songKey: true, bpm: true, lyricsLink: true, lyricsText: true,
  categoryNames: true, status: true, rejectionReason: true,
  approvedSongId: true, processedAt: true, createdAt: true, updatedAt: true,
  requester: { select: { melomingAlias: { select: { id: true } },
    profile: { select: { nickname: true } }, soop: { select: { profile_image_url: true } } } },
  channel: { select: { name: true } },
  processedBy: { select: { melomingAlias: { select: { id: true } }, profile: { select: { nickname: true } } } },
  approvedSong: { select: { id: true, title: true } },
} satisfies Prisma.SongAddRequestSelect;
type SongAddRequestWithRelations = Prisma.SongAddRequestGetPayload<{ select: typeof songAddRequestSelect }>;

export class SongAddRequestService {
  constructor(private readonly prisma: Prisma.TransactionClient, private readonly roomId: string, private readonly ownerId: string | null) {}
  async createRequest(
    userId: string,
    dto: SongAddRequestCreateDto,
  ) {
    // 1. 권한 체크 - 권한이 있으면 직접 등록하라고 안내
    const hasPermission = await this.hasChannelContentPermission(
      userId,
      dto.channelId,
    );

    if (hasPermission) {
      throw new BadRequestException(
        '이 채널에 노래 등록 권한이 있습니다. 직접 등록해주세요.',
      );
    }

    // 2. 채널 존재 확인
    if (dto.channelId !== 1) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }
    if (
      (await new ChannelMusicbookSettingsService(this.prisma).usesProficiencyAsPrimary(
        this.roomId,
      )) &&
      !this.isValidRating(dto.proficiency)
    ) {
      throw new BadRequestException('숙련도를 입력해주세요.');
    }

    // 3. 중복 신청 체크 (같은 채널+제목+아티스트, PENDING 상태)
    const existingRequest = await this.prisma.songAddRequest.findFirst({
      where: {
        channelId: this.roomId,
        title: dto.title.trim(),
        artistName: dto.artistName.trim(),
        status: SongAddRequestStatus.PENDING,
      },
    });

    if (existingRequest) {
      throw new ConflictException(
        '동일한 노래에 대한 신청이 이미 대기 중입니다.',
      );
    }

    // 4. 신청 생성
    const request = await this.prisma.songAddRequest.create({
      data: {
        id: await nextChannelContentId(this.prisma),
        requesterId: userId,
        channelId: this.roomId,
        title: dto.title.trim(),
        artistName: dto.artistName.trim(),
        albumArt: dto.albumArt ?? null,
        karaokeUrl: dto.karaokeUrl ?? null,
        coverUrl: dto.coverUrl ?? null,
        originalUrl: dto.originalUrl ?? null,
        difficulty: dto.difficulty ?? null,
        proficiency: dto.proficiency ?? null,
        songKey: dto.songKey ?? null,
        bpm: dto.bpm ?? null,
        lyricsLink: dto.lyricsLink ?? null,
        lyricsText: dto.lyricsText ?? null,
        categoryNames: dto.categoryNames
          ? JSON.stringify(dto.categoryNames)
          : null,
        status: SongAddRequestStatus.PENDING,
      },
      select: songAddRequestSelect,
    });

    return this.toResponseDto(request);
  }

  /**
   * 노래 신청 승인
   * @param dto 수정된 값 (optional) - 제공된 필드만 원본 요청 값을 덮어씀
   */
  async approveRequest(
    userId: string,
    requestId: number,
    dto?: SongAddRequestApproveDto,
  ) {
    const request = await this.prisma.songAddRequest.findUnique({
      where: { id: requestId, channelId: this.roomId },
      select: {
        ...songAddRequestSelect,
        channelId: true,
        requesterId: true,
      },
    });

    if (!request) {
      throw new NotFoundException('신청을 찾을 수 없습니다.');
    }

    // 권한 체크
    const hasPermission = await this.hasChannelContentPermission(
      userId,
      request.channelId,
    );

    if (!hasPermission) {
      throw new ForbiddenException('이 신청을 처리할 권한이 없습니다.');
    }

    // 상태 체크
    if (request.status !== SongAddRequestStatus.PENDING) {
      throw new BadRequestException('이미 처리된 신청입니다.');
    }

    // 수정된 값 또는 원본 값 사용
    const finalTitle = dto?.title?.trim() || request.title;
    const finalArtistName = dto?.artistName?.trim() || request.artistName;
    const finalKaraokeUrl = dto?.karaokeUrl ?? request.karaokeUrl;
    const finalCoverUrl = dto?.coverUrl ?? request.coverUrl;
    const finalOriginalUrl = dto?.originalUrl ?? request.originalUrl;
    const finalDifficulty = dto?.difficulty ?? request.difficulty ?? 1;
    const finalProficiency = dto?.proficiency ?? request.proficiency;
    const finalSongKey = dto?.songKey ?? request.songKey;
    const finalBpm = dto?.bpm ?? request.bpm;
    const finalLyricsLink = dto?.lyricsLink ?? request.lyricsLink;
    const finalLyricsText = dto?.lyricsText ?? request.lyricsText;

    // 카테고리: dto가 있으면 dto 사용, 없으면 원본
    let finalCategoryNames: string[] | undefined;
    if (dto?.categoryNames !== undefined) {
      finalCategoryNames = dto.categoryNames;
    } else if (request.categoryNames) {
      try {
        finalCategoryNames = JSON.parse(request.categoryNames);
      } catch {
        // ignore
      }
    }
    if (
      (await new ChannelMusicbookSettingsService(this.prisma).usesProficiencyAsPrimary(
        request.channelId,
      )) &&
      !this.isValidRating(finalProficiency)
    ) {
      throw new BadRequestException('숙련도를 입력해주세요.');
    }

    // 트랜잭션으로 노래 생성 및 신청 상태 변경
    const result = await (async () => {
      const tx = this.prisma;
      const channelId = request.channelId;

      // 1. 아티스트 조회 또는 생성
      let artist = await tx.artist.findFirst({
        where: { name: finalArtistName, channelId },
      });

      if (!artist) {
        artist = await tx.artist.create({
          data: {
            id: await nextChannelContentId(tx),
            name: finalArtistName,
            nameSearchable: normalizeForSearch(finalArtistName),
            channelId,
          },
        });
      }

      // 2. 앨범 아트 처리
      const finalAlbumArt = dto?.albumArt ?? request.albumArt;

      // 3. 노래 생성
      const song = await tx.song.create({
        data: {
          id: await nextChannelContentId(tx),
          title: finalTitle,
          titleSearchable: normalizeForSearch(finalTitle),
          artistId: artist.id,
          channelId,
          albumArt: finalAlbumArt,
          karaokeUrl: finalKaraokeUrl,
          coverUrl: finalCoverUrl,
          originalUrl: finalOriginalUrl,
          difficulty: finalDifficulty,
          proficiency: finalProficiency,
          songKey: finalSongKey,
          bpm: finalBpm,
          lyricsLink: finalLyricsLink,
          lyricsText: finalLyricsText,
        },
        select: { id: true },
      });

      // 4. 카테고리 처리
      if (finalCategoryNames && finalCategoryNames.length > 0) {
        const categoryIds = await new SongHelperService(this.prisma).createNewCategoriesByChannel(
          finalCategoryNames,
          channelId,
        );

        if (categoryIds.length > 0) {
          const uniqueCategoryIds = [...new Set(categoryIds)];
          for (const categoryId of uniqueCategoryIds) {
            await tx.songCategory.create({ data: { id: await nextChannelContentId(tx), songId: song.id, categoryId } });
          }
        }
      }

      // 5. 신청 상태 변경
      const updatedRequest = await tx.songAddRequest.update({
        where: { id: requestId, channelId: this.roomId },
        data: {
          status: SongAddRequestStatus.APPROVED,
          processedById: userId,
          processedAt: new Date(),
          approvedSongId: song.id,
        },
        select: songAddRequestSelect,
      });

      return { updatedRequest, songId: song.id };
    })();

    return this.toResponseDto(result.updatedRequest);
  }

  /**
   * 노래 신청 거절
   */
  async rejectRequest(
    userId: string,
    requestId: number,
    dto: SongAddRequestRejectDto,
  ) {
    const request = await this.prisma.songAddRequest.findUnique({
      where: { id: requestId, channelId: this.roomId },
      select: {
        ...songAddRequestSelect,
        channelId: true,
        requesterId: true,
      },
    });

    if (!request) {
      throw new NotFoundException('신청을 찾을 수 없습니다.');
    }

    // 권한 체크
    const hasPermission = await this.hasChannelContentPermission(
      userId,
      request.channelId,
    );

    if (!hasPermission) {
      throw new ForbiddenException('이 신청을 처리할 권한이 없습니다.');
    }

    // 상태 체크
    if (request.status !== SongAddRequestStatus.PENDING) {
      throw new BadRequestException('이미 처리된 신청입니다.');
    }

    // 신청 상태 변경
    const updatedRequest = await this.prisma.songAddRequest.update({
      where: { id: requestId, channelId: this.roomId },
      data: {
        status: SongAddRequestStatus.REJECTED,
        processedById: userId,
        processedAt: new Date(),
        rejectionReason: dto.reason?.trim() ?? null,
      },
      select: songAddRequestSelect,
    });

    return this.toResponseDto(updatedRequest);
  }

  /**
   * 노래 신청 취소 (신청자 본인만)
   */
  async cancelRequest(
    userId: string,
    requestId: number,
  ) {
    const request = await this.prisma.songAddRequest.findUnique({
      where: { id: requestId, channelId: this.roomId },
      select: {
        ...songAddRequestSelect,
        requesterId: true,
      },
    });

    if (!request) {
      throw new NotFoundException('신청을 찾을 수 없습니다.');
    }

    // 본인 확인
    if (request.requesterId !== userId) {
      throw new ForbiddenException('본인의 신청만 취소할 수 있습니다.');
    }

    // 상태 체크
    if (request.status !== SongAddRequestStatus.PENDING) {
      throw new BadRequestException('대기 중인 신청만 취소할 수 있습니다.');
    }

    const updatedRequest = await this.prisma.songAddRequest.update({
      where: { id: requestId, channelId: this.roomId },
      data: {
        status: SongAddRequestStatus.CANCELED,
      },
      select: songAddRequestSelect,
    });

    return this.toResponseDto(updatedRequest);
  }

  /**
   * 내 신청 목록 조회
   */
  async getMyRequests(
    userId: string,
    query: SongAddRequestListQueryDto,
  ) {
    const take = query.take ?? 20;

    const requests = await this.prisma.songAddRequest.findMany({
      where: {
        requesterId: userId,
        channelId: this.roomId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursorId ? { cursor: { id: query.cursorId }, skip: 1 } : {}),
      take,
      select: songAddRequestSelect,
    });

    const nextCursor =
      requests.length === take ? requests[requests.length - 1]!.id : undefined;

    return {
      items: requests.map((r) => this.toResponseDto(r)),
      nextCursor,
    };
  }

  /**
   * 채널 신청 목록 조회 (채널 관리자용)
   */
  async getChannelRequests(
    userId: string,
    channelId: string,
    query: SongAddRequestListQueryDto,
  ) {
    // 권한 체크
    const hasPermission = await this.hasChannelContentPermission(
      userId,
      channelId,
    );

    if (!hasPermission) {
      throw new ForbiddenException('이 채널의 신청을 조회할 권한이 없습니다.');
    }

    const take = query.take ?? 20;

    const [requests, pendingCount] = await Promise.all([
      this.prisma.songAddRequest.findMany({
        where: {
          channelId,
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(query.cursorId ? { cursor: { id: query.cursorId }, skip: 1 } : {}),
        take,
        select: songAddRequestSelect,
      }),
      this.prisma.songAddRequest.count({
        where: {
          channelId,
          status: SongAddRequestStatus.PENDING,
        },
      }),
    ]);

    const nextCursor =
      requests.length === take ? requests[requests.length - 1]!.id : undefined;

    return {
      items: requests.map((r) => this.toResponseDto(r)),
      nextCursor,
      pendingCount,
    };
  }

  private toResponseDto(
    request: SongAddRequestWithRelations,
  ) {
    if (!request.requester.melomingAlias || !request.requester.profile) {
      throw new ServiceUnavailableException('신청자 정보를 조회할 수 없습니다.');
    }
    if (request.processedBy && (!request.processedBy.melomingAlias || !request.processedBy.profile)) {
      throw new ServiceUnavailableException('처리자 정보를 조회할 수 없습니다.');
    }
    let categoryNames: string[] | undefined;
    if (request.categoryNames) {
      try {
        categoryNames = JSON.parse(request.categoryNames);
      } catch {
        categoryNames = undefined;
      }
    }

    return {
      id: request.id,
      requester: {
        id: request.requester.melomingAlias.id,
        nickname: request.requester.profile.nickname,
        profileImageUrl: request.requester.soop?.profile_image_url ?? undefined,
      },
      channel: {
        id: 1,
        name: request.channel.name,
        webPath: 'hurogi',
        profileImageUrl: '/images/hurogi-profile.png',
      },
      title: request.title,
      artistName: request.artistName,
      albumArt: request.albumArt ?? undefined,
      karaokeUrl: request.karaokeUrl ?? undefined,
      coverUrl: request.coverUrl ?? undefined,
      originalUrl: request.originalUrl ?? undefined,
      difficulty: request.difficulty ?? undefined,
      proficiency: request.proficiency ?? undefined,
      songKey: request.songKey ?? undefined,
      bpm: request.bpm ?? undefined,
      lyricsLink: request.lyricsLink ?? undefined,
      lyricsText: request.lyricsText ?? undefined,
      categoryNames,
      status: request.status,
      processedBy: request.processedBy
        ? {
            id: request.processedBy.melomingAlias!.id,
            nickname: request.processedBy.profile!.nickname,
          }
        : undefined,
      processedAt: request.processedAt ?? undefined,
      rejectionReason: request.rejectionReason ?? undefined,
      approvedSong: request.approvedSong
        ? {
            id: request.approvedSong.id,
            title: request.approvedSong.title,
          }
        : undefined,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private isValidRating(value: unknown): value is number {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 5
    );
  }

  private async hasChannelContentPermission(userId: string, channelId: string | number) {
    return (channelId === this.roomId || channelId === 1) && this.ownerId === userId;
  }
}
