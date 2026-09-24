import { Injectable, NotFoundException } from '@nestjs/common';
import { LiveSessionType, SongRequestSource } from '../../../../generated/prisma/client.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import { OverlayLayoutService } from '../overlay-layout.service.js';
import { OverlayThemeService } from '../overlay-theme.service.js';
import { SongPricingService } from '../song-pricing/song-pricing.service.js';
import { ChannelSongRequestSettingsService } from '../channel-song-request-settings.service.js';
import { OmakaseService } from '../omakase.service.js';
import { mergeEffectiveSongRequestSettings } from '../effective-song-request-settings.js';
import { overlaySessionSelect, overlaySongRequestSelect } from './prisma/overlay.selections.js';
import type { OverlayDataResponseDto, OverlayPlaybackSnapshotDto, OverlayPlaybackSnapshotItemDto } from './dto/response/overlay-data.response.dto.js';
import type { WidgetType as OverlayWidgetTypeValue } from '../theme-manifest/widget-types.js';

interface GetOverlayDataOptions { includePlaybackSnapshot?: boolean; requestedSessionId?: number | null; }
interface PlaybackOrdering { sessionEpoch: number | null; revision: number | null; }

/** Original Meloming overlay projection, scoped to Rogichat's single owner room. */
@Injectable()
export class OverlayService {
  private readonly overlayLayoutService: OverlayLayoutService;
  private readonly overlayThemeService: OverlayThemeService;
  private readonly songPricingService: SongPricingService;
  private readonly channelSongRequestSettingsService: ChannelSongRequestSettingsService;

  constructor(private readonly prisma: Prisma.TransactionClient, private readonly roomId: string) {
    this.overlayLayoutService = new OverlayLayoutService(prisma);
    this.overlayThemeService = new OverlayThemeService(prisma);
    this.songPricingService = new SongPricingService(prisma);
    this.channelSongRequestSettingsService = new ChannelSongRequestSettingsService(prisma);
  }
  async getOverlayData(
    token: string,
    liveSessionId?: number,
    options: GetOverlayDataOptions = {},
  ): Promise<OverlayDataResponseDto> {
    // 채널 조회 (고정 토큰으로)
    const room = await this.prisma.rooms.findUnique({
      where: { overlay_token: token },
      select: { id: true, name: true, channelDisplaySettings: true },
    });
    if (!room || room.id !== this.roomId) throw new NotFoundException();
    const channel = {
      id: 1, name: room.name, webPath: 'hurogi',
      profileImageUrl: room.channelDisplaySettings?.profileImageUrl ?? '/images/hurogi-profile.png',
      themeColor: room.channelDisplaySettings?.themeColor ?? '#ff8c9d',
    };

    const totalLayoutSnapshot =
      await this.overlayLayoutService.getLayoutSnapshot(this.roomId, 'total');

    const widgetCustomCss: Partial<Record<OverlayWidgetTypeValue, string | null>> = {};

    // 통합 테마 시스템: resolveForOverlay가 lazy-create + resolved 계산을 모두 처리
    const { resolvedThemes, resolvedOptions } =
      await this.overlayThemeService.resolveForOverlay(this.roomId);

    const activeSessionWhere = {
      channelId: this.roomId,
      status: 'ACTIVE' as const,
      sessionType: LiveSessionType.STANDARD,
    };
    const findCurrentActiveSession = () =>
      this.prisma.liveSession.findFirst({
        where: activeSessionWhere,
        orderBy: [{ startedAt: 'desc' as const }, { id: 'desc' as const }],
        select: overlaySessionSelect,
      });

    // Prefer the requested session, but never turn a stale session id into an
    // authoritative empty overlay while the same token has a newer active live.
    const session = liveSessionId
      ? (await this.prisma.liveSession.findFirst({
          where: {
            ...activeSessionWhere,
            id: liveSessionId,
          },
          select: overlaySessionSelect,
        })) ?? (await findCurrentActiveSession())
      : await findCurrentActiveSession();

    // 세션이 없으면 채널 정보만 반환
    if (!session) {
      const omakase = await this.getOverlayOmakase(this.roomId, channel.name);
      // ACTIVE 세션이 없어도 (= 방금 라이브가 끝난 직후) 스냅샷의 (sessionEpoch,
      // revision) 순서가 유지되도록, 이 채널의 가장 최근 세션(ENDED 포함)의 id 를
      // sessionEpoch 로, 그 playbackRevision 을 revision 으로 실어 보낸다.
      // endSession 이 revision 을 bump 했으므로 이 null-clear 스냅샷은 직전
      // PLAYING 스냅샷보다 (같은 epoch 에서) 더 높은 revision 을 가져 reducer 가
      // sessionEpoch 0 으로 오판해 drop 하는 일을 막는다.
      const mostRecentSession = await this.prisma.liveSession.findFirst({
        where: {
          channelId: this.roomId,
          sessionType: LiveSessionType.STANDARD,
        },
        orderBy: [{ startedAt: 'desc' as const }, { id: 'desc' as const }],
        select: { id: true, playbackRevision: true },
      });
      return this.withPlaybackSnapshot(
        {
          sessionId: null,
          channel: {
            id: channel.id,
            name: channel.name,
            webPath: channel.webPath,
            profileImageUrl: channel.profileImageUrl,
            themeColor: channel.themeColor ?? '#3B82F6',
          },
          settings: null,
          queue: [],
          setlist: [],
          omakase,
          resolvedThemes,
          resolvedOptions,
          widgetCustomCss,
          totalLayout: totalLayoutSnapshot.layout,
          totalLayoutVersion: totalLayoutSnapshot.layoutVersion,
          totalLayoutUpdatedAt: totalLayoutSnapshot.layoutUpdatedAt,
          startedAt: null,
          isLive: false,
        },
        options,
        {
          sessionEpoch: mostRecentSession?.id ?? null,
          revision: mostRecentSession?.playbackRevision ?? null,
        },
      );
    }

    // 대기열 조회 (PENDING 상태, 우선순위 및 순서 정렬)
    const queue = await this.prisma.songRequest.findMany({
      where: {
        liveSessionId: session.id,
        status: 'PENDING',
        source: { not: SongRequestSource.COMPETITOR },
      },
      select: overlaySongRequestSelect,
      orderBy: [
        { priority: 'desc' },
        { queueOrder: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    // 셋리스트 조회 (COMPLETED + PLAYING + PENDING + ACCEPTED 상태)
    const setlist = await this.prisma.songRequest.findMany({
      where: {
        liveSessionId: session.id,
        status: { in: ['COMPLETED', 'PLAYING', 'PENDING', 'ACCEPTED'] },
        source: { not: SongRequestSource.COMPETITOR },
      },
      select: overlaySongRequestSelect,
      orderBy: [{ queueOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const nowPlaying = await this.prisma.songRequest.findFirst({
      where: {
        liveSessionId: session.id,
        status: 'PLAYING',
        source: { not: SongRequestSource.COMPETITOR },
      },
      // 일시적 중복 PLAYING 이 생겨도 콘솔/오버레이가 같은 행을 고르도록 결정적 정렬.
      orderBy: [{ playedAt: 'desc' }, { id: 'desc' }],
      select: overlaySongRequestSelect,
    });

    const pricingSettings = await this.songPricingService.getPricingSettings(
      this.roomId,
    );
    const pricingData =
      this.songPricingService.extractPricingData(pricingSettings);
    const omakase = await this.getOverlayOmakase(this.roomId, channel.name);
    const channelSettings =
      await this.channelSongRequestSettingsService.getByChannelId(this.roomId);
    const effectiveSettings = mergeEffectiveSongRequestSettings(
      session.settings,
      channelSettings,
    );

    const mapRequest = (request: (typeof queue)[number]) => ({
      id: request.id,
      song: request.song
        ? {
            id: request.song.id,
            title: request.song.title,
            artist: request.song.artist
              ? { id: request.song.artist.id, name: request.song.artist.name }
              : { id: 0, name: '' },
            albumArt: request.song.albumArt,
            karaokeUrl: request.song.karaokeUrl,
            coverUrl: request.song.coverUrl,
            originalUrl: request.song.originalUrl,
            mrVideoUrl: request.song.mrVideoUrl,
            lyricsLink: request.song.lyricsLink,
            // lyricsText: 작가 비공개 메모 — overlay public 응답에서 제외 (보안 정책).
            description: request.song.description,
            difficulty: request.song.difficulty,
            proficiency: request.song.proficiency,
            songKey: request.song.songKey,
            bpm: request.song.bpm,
            preferredPitchSemitones: request.song.preferredPitchSemitones,
          }
        : null,
      rawArtist: request.rawArtist,
      rawTitle: request.rawTitle,
      rawMessage: request.rawMessage,
      requesterPlatformId: request.requesterPlatformId,
      requesterNickname: request.requesterNickname,
      status: request.status,
      source: request.source,
      requestType: request.requestType,
      donationAmount: request.donationAmount ?? null,
      donationNativeAmount: request.donationNativeAmount ?? null,
      donationCurrency: request.donationCurrency ?? null,
      priority: request.priority,
      queueOrder: request.queueOrder,
      calculatedPrice: request.calculatedPrice,
      priceSource: request.priceSource,
      formattedPrice: this.songPricingService.formatCalculatedPrice(
        request.calculatedPrice,
        session.platform,
        pricingData.currencyConfigs,
      ),
      playedAt: request.playedAt,
      completedAt: request.completedAt,
      rejectionReason: request.rejectionReason,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    });

    return this.withPlaybackSnapshot(
      {
        sessionId: session.id,
        channel: {
          id: channel.id,
          name: channel.name,
          webPath: channel.webPath,
          profileImageUrl: channel.profileImageUrl,
          themeColor: channel.themeColor ?? '#3B82F6',
        },
        settings: effectiveSettings,
        queue: queue.map((request) => mapRequest(request)),
        setlist: setlist.map((request) => mapRequest(request)),
        nowPlaying: nowPlaying ? mapRequest(nowPlaying) : null,
        omakase,
        resolvedThemes,
        resolvedOptions,
        widgetCustomCss,
        totalLayout: totalLayoutSnapshot.layout,
        totalLayoutVersion: totalLayoutSnapshot.layoutVersion,
        totalLayoutUpdatedAt: totalLayoutSnapshot.layoutUpdatedAt,
        startedAt: session.startedAt,
        isLive: true,
      },
      options,
      { sessionEpoch: session.id, revision: session.playbackRevision },
    );
  }
  private async getOverlayOmakase(channelId: string, channelName: string) {
    const settings = await this.prisma.channelOmakaseSettings.findUnique({
      where: { channelId },
      select: {
        enabled: true,
        displayName: true,
        count: true,
      },
    });
    if (!settings?.enabled) {
      return null;
    }
    return {
      enabled: settings.enabled,
      displayName:
        settings.displayName ?? OmakaseService.defaultDisplayName(channelName),
      count: settings.count,
    };
  }

  private withPlaybackSnapshot(
    data: OverlayDataResponseDto,
    options: GetOverlayDataOptions,
    playback: PlaybackOrdering,
  ): OverlayDataResponseDto {
    if (!options.includePlaybackSnapshot) {
      return data;
    }

    return {
      ...data,
      playbackSnapshot: this.buildPlaybackSnapshot(data, options, playback),
    };
  }

  private buildPlaybackSnapshot(
    data: OverlayDataResponseDto,
    options: GetOverlayDataOptions,
    playback: PlaybackOrdering,
  ): OverlayPlaybackSnapshotDto {
    const queue = data.queue.map((request) =>
      this.mapPlaybackSnapshotItem(request),
    );
    const setlist = data.setlist.map((request) =>
      this.mapPlaybackSnapshotItem(request),
    );
    const nowPlaying = data.nowPlaying
      ? this.mapPlaybackSnapshotItem(data.nowPlaying)
      : null;

    return {
      event: 'overlay.playback.snapshot.v1',
      contractVersion: 1,
      channelId: data.channel.id,
      activeSessionId: data.sessionId,
      requestedSessionId: options.requestedSessionId ?? null,
      // GATE 0: 단일 revision source. sessionEpoch = LiveSession.id (autoincrement,
      // 세션마다 단조 증가), revision = LiveSession.playbackRevision (command 마다
      // { increment: 1 } bump). computeShadowRevision(ms timestamp) 은 카운터와 섞이면
      // client 가 counter <= timestamp 로 모든 실제 스냅샷을 drop 하므로 제거됨.
      sessionEpoch: playback.sessionEpoch,
      revision: playback.revision,
      isLive: data.isLive,
      nowPlaying,
      queue,
      setlist,
      settings: data.settings,
      themes: data.resolvedThemes,
      layout: data.totalLayout ?? null,
      layoutVersion: data.totalLayoutVersion ?? 0,
      layoutUpdatedAt: data.totalLayoutUpdatedAt ?? null,
      source: {
        producer: 'meloming-back',
        mode: 'rest-sync-shadow',
      },
      emittedAt: new Date().toISOString(),
    };
  }

  private mapPlaybackSnapshotItem(
    request: OverlayDataResponseDto['queue'][number],
  ): OverlayPlaybackSnapshotItemDto {
    const asSyncRequest = request as typeof request & {
      sourceChannelId?: number | null;
      availableChannels?: unknown[];
    };

    return {
      requestId: request.id,
      songId: request.song?.id ?? null,
      title: request.song?.title ?? request.rawTitle,
      artist: request.song?.artist?.name ?? request.rawArtist,
      albumArt: request.song?.albumArt ?? null,
      coverUrl: request.song?.coverUrl ?? null,
      rawTitle: request.rawTitle,
      rawArtist: request.rawArtist,
      requesterPlatformId: request.requesterPlatformId,
      requesterNickname: request.requesterNickname,
      status: request.status,
      source: request.source,
      requestType: request.requestType,
      donationAmount: request.donationAmount ?? null,
      donationNativeAmount: request.donationNativeAmount ?? null,
      donationCurrency: request.donationCurrency ?? null,
      priority: request.priority,
      queueOrder: request.queueOrder,
      calculatedPrice: request.calculatedPrice ?? null,
      priceSource: request.priceSource ?? null,
      formattedPrice: request.formattedPrice ?? null,
      playedAt: this.toIsoStringOrNull(request.playedAt),
      completedAt: this.toIsoStringOrNull(request.completedAt),
      createdAt: this.toIsoString(request.createdAt),
      updatedAt: this.toIsoString(request.updatedAt),
      sourceChannelId: asSyncRequest.sourceChannelId ?? null,
      availableChannels: asSyncRequest.availableChannels ?? [],
    };
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }

  private toIsoStringOrNull(value?: Date | string | null): string | null {
    if (!value) {
      return null;
    }
    return this.toIsoString(value);
  }
}
