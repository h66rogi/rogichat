import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, SongAddRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelService } from '../channel/channel.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/constants/notification-types';
import { SongHelperService } from './song-helper.service';
import { SongAlbumArtService } from './song-album-art.service';
import { SongCacheService } from './song-cache.service';
import { normalizeForSearch } from './utils/search-normalize';
import { PointsService } from '../points/points.service';
import { POINT_ACTIONS } from '../points/constants/point-actions';
import { buildPointReason } from '../points/utils/point-reason';
import { SongAddRequestCreateDto } from './dto/requests/song-add-request-create.dto';
import { SongAddRequestApproveDto } from './dto/requests/song-add-request-approve.dto';
import { SongAddRequestRejectDto } from './dto/requests/song-add-request-reject.dto';
import { SongAddRequestListQueryDto } from './dto/requests/song-add-request-list.query.dto';
import { ChannelSongPermissionResponseDto } from './dto/responses/channel-song-permission.response.dto';
import {
  SongAddRequestResponseDto,
  SongAddRequestListResponseDto,
} from './dto/responses/song-add-request.response.dto';
import { ChannelMusicbookSettingsService } from '../channel/channel-musicbook-settings.service';

const songAddRequestSelect = {
  id: true,
  title: true,
  artistName: true,
  albumArt: true,
  karaokeUrl: true,
  coverUrl: true,
  originalUrl: true,
  difficulty: true,
  proficiency: true,
  songKey: true,
  bpm: true,
  lyricsLink: true,
  lyricsText: true,
  categoryNames: true,
  status: true,
  rejectionReason: true,
  approvedSongId: true,
  processedAt: true,
  createdAt: true,
  updatedAt: true,
  requester: {
    select: {
      id: true,
      nickname: true,
      profileImageUrl: true,
    },
  },
  channel: {
    select: {
      id: true,
      name: true,
      webPath: true,
      profileImageUrl: true,
    },
  },
  processedBy: {
    select: {
      id: true,
      nickname: true,
    },
  },
  approvedSong: {
    select: {
      id: true,
      title: true,
    },
  },
} satisfies Prisma.SongAddRequestSelect;

type SongAddRequestWithRelations = Prisma.SongAddRequestGetPayload<{
  select: typeof songAddRequestSelect;
}>;

@Injectable()
export class SongAddRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelService: ChannelService,
    private readonly notificationsService: NotificationsService,
    private readonly songHelper: SongHelperService,
    private readonly albumArtService: SongAlbumArtService,
    private readonly songCacheService: SongCacheService,
    private readonly pointsService: PointsService,
    private readonly musicbookSettingsService: ChannelMusicbookSettingsService,
  ) {}

  /**
   * 채널에 대한 노래 등록 권한 체크
   */
  async checkChannelPermission(
    userId: number,
    channelId: number,
  ): Promise<ChannelSongPermissionResponseDto> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    const hasPermission = await this.hasChannelContentPermission(
      userId,
      channelId,
    );

    return {
      channelId,
      hasPermission,
      canRequestSong: !hasPermission,
    };
  }

  /**
   * 노래 등록 신청 생성
   */
  async createRequest(
    userId: number,
    dto: SongAddRequestCreateDto,
  ): Promise<SongAddRequestResponseDto> {
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
    const channel = await this.prisma.channel.findUnique({
      where: { id: dto.channelId },
      select: { id: true, name: true, webPath: true, userId: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }
    if (
      (await this.musicbookSettingsService.usesProficiencyAsPrimary(
        dto.channelId,
      )) &&
      !this.isValidRating(dto.proficiency)
    ) {
      throw new BadRequestException('숙련도를 입력해주세요.');
    }

    // 3. 중복 신청 체크 (같은 채널+제목+아티스트, PENDING 상태)
    const existingRequest = await this.prisma.songAddRequest.findFirst({
      where: {
        channelId: dto.channelId,
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
        requesterId: userId,
        channelId: dto.channelId,
        title: dto.title.trim(),
        artistName: dto.artistName.trim(),
        albumArt: dto.albumArt,
        karaokeUrl: dto.karaokeUrl,
        coverUrl: dto.coverUrl,
        originalUrl: dto.originalUrl,
        difficulty: dto.difficulty,
        proficiency: dto.proficiency,
        songKey: dto.songKey,
        bpm: dto.bpm,
        lyricsLink: dto.lyricsLink,
        lyricsText: dto.lyricsText,
        categoryNames: dto.categoryNames
          ? JSON.stringify(dto.categoryNames)
          : null,
        status: SongAddRequestStatus.PENDING,
      },
      select: songAddRequestSelect,
    });

    // 5. 채널 관리자들에게 알림 발송
    await this.notifyChannelManagers(channel.id, channel.userId, request);

    return this.toResponseDto(request);
  }

  /**
   * 노래 신청 승인
   * @param dto 수정된 값 (optional) - 제공된 필드만 원본 요청 값을 덮어씀
   */
  async approveRequest(
    userId: number,
    requestId: number,
    dto?: SongAddRequestApproveDto,
  ): Promise<SongAddRequestResponseDto> {
    const request = await this.prisma.songAddRequest.findUnique({
      where: { id: requestId },
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
      (await this.musicbookSettingsService.usesProficiencyAsPrimary(
        request.channelId,
      )) &&
      !this.isValidRating(finalProficiency)
    ) {
      throw new BadRequestException('숙련도를 입력해주세요.');
    }

    // 트랜잭션으로 노래 생성 및 신청 상태 변경
    const result = await this.prisma.$transaction(async (tx) => {
      const channelId = request.channelId;

      // 1. 아티스트 조회 또는 생성
      let artist = await tx.artist.findFirst({
        where: { name: finalArtistName, channelId },
      });

      if (!artist) {
        artist = await tx.artist.create({
          data: {
            name: finalArtistName,
            nameSearchable: normalizeForSearch(finalArtistName),
            channelId,
          },
        });
      }

      // 2. 앨범 아트 처리
      let finalAlbumArt = dto?.albumArt ?? request.albumArt;
      if (!finalAlbumArt) {
        const albumArtResult = await this.albumArtService.searchAlbumArtFromDB(
          finalTitle,
          finalArtistName,
        );
        if (albumArtResult.success && albumArtResult.result) {
          finalAlbumArt = albumArtResult.result.albumArt;
        }
      }
      finalAlbumArt =
        this.albumArtService.sanitizeAlbumArtUrl(finalAlbumArt) ?? null;

      // 3. 노래 생성
      const song = await tx.song.create({
        data: {
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
        const categoryIds = await this.songHelper.createNewCategoriesByChannel(
          finalCategoryNames,
          channelId,
        );

        if (categoryIds.length > 0) {
          const uniqueCategoryIds = [...new Set(categoryIds)];
          await tx.songCategory.createMany({
            data: uniqueCategoryIds.map((categoryId) => ({
              songId: song.id,
              categoryId,
            })),
          });
        }
      }

      // 5. 신청 상태 변경
      const updatedRequest = await tx.songAddRequest.update({
        where: { id: requestId },
        data: {
          status: SongAddRequestStatus.APPROVED,
          processedById: userId,
          processedAt: new Date(),
          approvedSongId: song.id,
        },
        select: songAddRequestSelect,
      });

      return { updatedRequest, songId: song.id };
    });

    // 캐시 클리어
    await this.songCacheService.clearChannelSongCaches(request.channelId);

    // 포인트 지급
    try {
      await this.grantSongCreatePointsFor(
        request.requesterId,
        [result.songId],
        request.channelId,
      );
    } catch {
      // 포인트 지급 실패해도 무시
    }

    // 신청자에게 알림 발송
    await this.notificationsService.enqueueSend(
      request.requesterId,
      {
        title: '노래 신청 승인',
        body: `"${request.title}" 노래 신청이 승인되었습니다.`,
        type: NotificationType.SONG_ADD_REQUEST_APPROVED,
        url: `/channel/${request.channel.webPath}`,
        data: {
          songAddRequestId: requestId,
          songId: result.songId,
          channelName: request.channel.name,
          songTitle: request.title,
        },
      },
      { saveInApp: true },
    );

    return this.toResponseDto(result.updatedRequest);
  }

  /**
   * 노래 신청 거절
   */
  async rejectRequest(
    userId: number,
    requestId: number,
    dto: SongAddRequestRejectDto,
  ): Promise<SongAddRequestResponseDto> {
    const request = await this.prisma.songAddRequest.findUnique({
      where: { id: requestId },
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
      where: { id: requestId },
      data: {
        status: SongAddRequestStatus.REJECTED,
        processedById: userId,
        processedAt: new Date(),
        rejectionReason: dto.reason?.trim(),
      },
      select: songAddRequestSelect,
    });

    // 신청자에게 알림 발송
    await this.notificationsService.enqueueSend(
      request.requesterId,
      {
        title: '노래 신청 거절',
        body: dto.reason
          ? `"${request.title}" 노래 신청이 거절되었습니다: ${dto.reason}`
          : `"${request.title}" 노래 신청이 거절되었습니다.`,
        type: NotificationType.SONG_ADD_REQUEST_REJECTED,
        url: `/mypage/song-requests`,
        data: {
          songAddRequestId: requestId,
          channelName: request.channel.name,
          songTitle: request.title,
          rejectionReason: dto.reason,
        },
      },
      { saveInApp: true },
    );

    return this.toResponseDto(updatedRequest);
  }

  /**
   * 노래 신청 취소 (신청자 본인만)
   */
  async cancelRequest(
    userId: number,
    requestId: number,
  ): Promise<SongAddRequestResponseDto> {
    const request = await this.prisma.songAddRequest.findUnique({
      where: { id: requestId },
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
      where: { id: requestId },
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
    userId: number,
    query: SongAddRequestListQueryDto,
  ): Promise<SongAddRequestListResponseDto> {
    const take = query.take ?? 20;

    const requests = await this.prisma.songAddRequest.findMany({
      where: {
        requesterId: userId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursorId ? { cursor: { id: query.cursorId }, skip: 1 } : {}),
      take,
      select: songAddRequestSelect,
    });

    const nextCursor =
      requests.length === take ? requests[requests.length - 1].id : undefined;

    return {
      items: requests.map((r) => this.toResponseDto(r)),
      nextCursor,
    };
  }

  /**
   * 채널 신청 목록 조회 (채널 관리자용)
   */
  async getChannelRequests(
    userId: number,
    channelId: number,
    query: SongAddRequestListQueryDto,
  ): Promise<SongAddRequestListResponseDto> {
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
      requests.length === take ? requests[requests.length - 1].id : undefined;

    return {
      items: requests.map((r) => this.toResponseDto(r)),
      nextCursor,
      pendingCount,
    };
  }

  /**
   * 특정 채널에 대한 content 권한 확인
   */
  private async hasChannelContentPermission(
    userId: number,
    channelId: number,
  ): Promise<boolean> {
    // 채널 소유자인지 확인
    const isOwner = await this.channelService.validateChannelOwnership(
      channelId,
      userId,
    );
    if (isOwner) return true;

    // 매니저 권한 확인
    const manager = await this.channelService.getManagerPermissions(
      channelId,
      userId,
    );
    if (manager?.isActive && manager.canManageContent) {
      return true;
    }

    return false;
  }

  /**
   * 채널 관리자들에게 알림 발송
   */
  private async notifyChannelManagers(
    channelId: number,
    ownerId: number,
    request: SongAddRequestWithRelations,
  ): Promise<void> {
    // 채널 소유자에게 알림
    await this.notificationsService.enqueueSend(
      ownerId,
      {
        title: '새 노래 등록 신청',
        body: `${request.requester.nickname}님이 "${request.title}" 노래 등록을 신청했습니다.`,
        type: NotificationType.SONG_ADD_REQUEST_RECEIVED,
        url: `/channel/${request.channel.webPath}/manage/song-requests`,
        data: {
          songAddRequestId: request.id,
          channelName: request.channel.name,
          requesterNickname: request.requester.nickname,
          songTitle: request.title,
        },
      },
      { saveInApp: true },
    );

    // canManageContent 권한이 있는 매니저들에게 알림
    const managers = await this.prisma.channelManager.findMany({
      where: {
        channelId,
        isActive: true,
        canManageContent: true,
      },
      select: { userId: true },
    });

    for (const manager of managers) {
      await this.notificationsService.enqueueSend(
        manager.userId,
        {
          title: '새 노래 등록 신청',
          body: `${request.requester.nickname}님이 "${request.title}" 노래 등록을 신청했습니다.`,
          type: NotificationType.SONG_ADD_REQUEST_RECEIVED,
          url: `/channel/${request.channel.webPath}/manage/song-requests`,
          data: {
            songAddRequestId: request.id,
            channelName: request.channel.name,
            requesterNickname: request.requester.nickname,
            songTitle: request.title,
          },
        },
        { saveInApp: true },
      );
    }
  }

  /**
   * 포인트 지급 (하루 최대 10곡)
   */
  private async grantSongCreatePointsFor(
    userId: number,
    songIds: number[],
    channelId: number,
  ): Promise<void> {
    const { startUtc, endUtc } = this.getKstDayBounds();
    const todayCount = await this.prisma.pointTransaction.count({
      where: {
        userId,
        action: POINT_ACTIONS.SONG_CREATE,
        type: 'CREDIT',
        createdAt: { gte: startUtc, lt: endUtc },
      },
    });
    let remaining = Math.max(0, 10 - todayCount);
    for (const id of songIds) {
      if (remaining <= 0) break;
      try {
        const songData = await this.prisma.song.findUnique({
          where: { id },
          select: { title: true, channel: { select: { name: true } } },
        });
        await this.pointsService.grant({
          userId,
          amount: 50,
          action: POINT_ACTIONS.SONG_CREATE,
          uniqueKey: `song:create:${id}`,
          reason: buildPointReason(POINT_ACTIONS.SONG_CREATE, {
            channelName: songData?.channel?.name ?? undefined,
            songTitle: songData?.title ?? undefined,
          }),
          referenceType: 'song',
          referenceId: String(id),
        });
        remaining -= 1;
      } catch {
        // ignore per-item failure
      }
    }
  }

  private getKstDayBounds(now: Date = new Date()): {
    startUtc: Date;
    endUtc: Date;
  } {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const kst = new Date(now.getTime() + KST_OFFSET_MS);
    kst.setHours(0, 0, 0, 0);
    const startUtc = new Date(kst.getTime() - KST_OFFSET_MS);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
    return { startUtc, endUtc };
  }

  /**
   * DB 모델을 Response DTO로 변환
   */
  private toResponseDto(
    request: SongAddRequestWithRelations,
  ): SongAddRequestResponseDto {
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
        id: request.requester.id,
        nickname: request.requester.nickname,
        profileImageUrl: request.requester.profileImageUrl ?? undefined,
      },
      channel: {
        id: request.channel.id,
        name: request.channel.name,
        webPath: request.channel.webPath ?? undefined,
        profileImageUrl: request.channel.profileImageUrl ?? undefined,
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
            id: request.processedBy.id,
            nickname: request.processedBy.nickname,
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
}
