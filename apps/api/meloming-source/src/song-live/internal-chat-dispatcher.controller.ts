import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { SongRequestQueueService } from '../song-request/song-request-queue.service';
import { SONG_REQUEST_EVENTS } from '../song-request/events/song-request.events';
import { ChatGateway } from './chat/chat.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { resolveChannelOperator } from './chat-permission.helper';
import { FromChatSongRequestDto } from './dto/request/from-chat-request.dto';
import { ChatBroadcastDto } from './dto/request/chat-broadcast.dto';
import { SessionCommandDto } from './dto/request/session-command.dto';
import { InfoCommandDto } from './dto/request/info-command.dto';
import { SyncStreamerRandomDto } from './dto/request/sync-streamer-random.dto';
import { FromChatSongbookAddDto } from './dto/request/from-chat-songbook-add.dto';
import { LiveSessionType, Prisma, StreamPlatform } from '@prisma/client';
import { songRequestWithSongSelect } from '../song-request/prisma/song-request.selections';
import { SongRequestService } from '../song-request/song-request.service';
import { SessionService } from './session.service';
import { SongMatcherService } from '../song-request/song-matcher.service';
import { SongMatcherV2Service } from '../song-request/v2/song-matcher-v2.service';
import { MetricsService } from '../metrics';
import { SongbookAddService } from '../songbook-add/songbook-add.service';
import {
  SONGBOOK_ADD_EVENTS,
  SongbookAddFeedbackEvent,
  SongbookAddOutcome,
} from '../songbook-add/songbook-add.events';
import { SyncLiveSessionService } from '../sync-room/sync-live-session.service';

@ApiTags('Chat Dispatcher (Internal)')
@UseGuards(InternalApiKeyGuard)
@Controller({ path: 'internal/chat-dispatcher', version: '1' })
export class InternalChatDispatcherController {
  private readonly logger = new Logger(InternalChatDispatcherController.name);
  private readonly processedCommands = new Map<string, number>();
  private readonly infoCommandLastFired = new Map<string, number>();
  private static readonly DEDUP_TTL_MS = 5 * 60 * 1000;
  private static readonly INFO_COOLDOWN_MS = 30 * 1000;

  constructor(
    private readonly queueService: SongRequestQueueService,
    private readonly chatGateway: ChatGateway,
    private readonly prisma: PrismaService,
    private readonly songRequestService: SongRequestService,
    private readonly sessionService: SessionService,
    private readonly eventEmitter: EventEmitter2,
    private readonly v1Matcher: SongMatcherService,
    private readonly matcherV2: SongMatcherV2Service,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
    private readonly songbookAddService: SongbookAddService,
    private readonly syncLiveSessionService: SyncLiveSessionService,
  ) {}

  /**
   * 채팅 신청곡 생성 (idempotent)
   * POST /v1/internal/chat-dispatcher/song-requests
   */
  @Post('song-requests')
  @ApiOperation({ summary: '채팅 신청곡 생성 (chat-dispatcher 전용)' })
  @ApiHeader({ name: 'X-Internal-Api-Key', required: true })
  async fromChat(@Body() dto: FromChatSongRequestDto) {
    // 멱등성: fast-path pre-read (단독으로는 race 방지 불충분, catch P2002가 진짜 보장)
    // 재시도 케이스이므로 오버레이 토스트는 emit하지 않음.
    const existing = await this.prisma.songRequest.findUnique({
      where: { streamMessageId: dto.streamMessageId },
      select: songRequestWithSongSelect,
    });
    if (existing) return existing;

    // 하이브리드 매칭: v1 먼저 시도 → 실패 시 v2 (Tier 1만 LLM 비용 발생).
    // v1 정상 매칭 케이스는 latency 변화 0. v1 실패 케이스만 v2가 추가로 잡음.
    // resolvedSongId가 있으면 addToQueue가 매칭 단계 skip하고 그 song으로 신청 생성.
    const resolvedSongId = await this.resolveSongIdHybrid(dto);

    try {
      const created = await this.queueService.addToQueue(dto.liveSessionId, {
        // 랜덤 신청은 백엔드가 채널 노래책에서 곡을 추출하므로 매칭 결과 무시
        songId: dto.requestType === 'RANDOM' ? undefined : resolvedSongId,
        rawArtist: dto.rawArtist,
        rawTitle: dto.rawTitle,
        rawMessage: dto.rawMessage,
        requesterPlatformId: dto.requesterPlatformId,
        requesterNickname: dto.requesterNickname,
        source: dto.source,
        donationAmount: dto.donationAmount,
        donationNativeAmount: dto.donationNativeAmount,
        donationCurrency: dto.donationCurrency,
        streamMessageId: dto.streamMessageId,
        isInternalRequest: true,
        requestType: dto.requestType,
        sourceChannelId: dto.sourceChannelId,
      });
      this.emitChatFeedback(dto, { outcome: 'accepted' });
      return created;
    } catch (err: any) {
      // P2002: unique constraint 위반 = 동시 요청 race → 기존 레코드 반환 (새 토스트 emit X)
      // 이 코드 경로에서 P2002는 streamMessageId에서만 발생 (id는 autoincrement)
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.prisma.songRequest.findUnique({
          where: { streamMessageId: dto.streamMessageId },
          select: songRequestWithSongSelect,
        });
      }
      const reason =
        err instanceof HttpException
          ? err.message
          : '신청곡 처리 중 오류가 발생했습니다.';
      this.emitChatFeedback(dto, { outcome: 'rejected', reason });
      throw err;
    }
  }

  /**
   * 하이브리드 매칭: v1 먼저 → 실패 시 v2.
   *
   * v1 흐름은 latency 변화 0 (정상 매칭 케이스). v1이 매칭 못하면 v2가 LLM까지
   * 동원해 추가로 시도하고, 그것도 실패하면 undefined 반환 (addToQueue가 기존
   * v1 매칭 + requireSongMatch 정책으로 폴백).
   *
   * SONG_MATCHER_V2_FALLBACK=false 면 v2 자체를 호출하지 않고 v1만 사용.
   * 회귀 발견 시 즉시 끄기 위한 kill switch.
   */
  private async resolveSongIdHybrid(
    dto: FromChatSongRequestDto,
  ): Promise<number | undefined> {
    if (!dto.rawMessage || !dto.rawMessage.trim()) return undefined;
    // 랜덤 신청은 백엔드가 노래책에서 곡을 추출하므로 매칭 자체가 불필요. LLM 비용 회피.
    if (dto.requestType === 'RANDOM') return undefined;

    const session = await this.prisma.liveSession.findUnique({
      where: { id: dto.liveSessionId },
      select: {
        channelId: true,
        sessionType: true,
        settings: { select: { requestCommand: true } },
        channel: {
          select: {
            songRequestSettings: { select: { requestCommand: true } },
          },
        },
      },
    });
    if (!session) return undefined;

    const matchChannelId = dto.sourceChannelId ?? session.channelId;

    // Step 1: v1 직접 호출 (기존 동작과 동일 — DB only, ~50ms).
    const v1MatchId = await this.tryV1Match(
      matchChannelId,
      dto.rawArtist,
      dto.rawTitle,
    );
    if (v1MatchId !== undefined) {
      this.metrics.songMatcherV2OutcomesTotal.inc({
        outcome: 'v1_match',
        tier: 'unknown',
      });
      return v1MatchId;
    }

    // Step 2: v1 실패 → v2 시도 (Tier 1이면 LLM까지 + 5-8s 가능).
    // kill switch로 끄면 즉시 v1만 사용.
    const v2Enabled =
      (this.config.get<string>('SONG_MATCHER_V2_FALLBACK') ?? 'true') ===
      'true';
    if (!v2Enabled) {
      this.metrics.songMatcherV2OutcomesTotal.inc({
        outcome: 'v1_no_match_v2_disabled',
        tier: 'unknown',
      });
      return undefined;
    }

    const requestCommand =
      session.sessionType === LiveSessionType.SYNC
        ? session.settings?.requestCommand ?? '!신청'
        : session.channel?.songRequestSettings?.requestCommand ?? '!신청';
    const t0 = Date.now();
    let v2Result;
    try {
      v2Result = await this.matcherV2.match({
        channelId: matchChannelId,
        rawMessage: dto.rawMessage,
        requestCommand,
      });
    } catch (e) {
      this.metrics.songMatcherV2OutcomesTotal.inc({
        outcome: 'error',
        tier: 'unknown',
      });
      this.logger.warn(
        `v2 fallback error session=${dto.liveSessionId} msg="${dto.rawMessage.slice(0, 60)}": ${(e as Error)?.message ?? e}`,
      );
      return undefined;
    }
    const dt = (Date.now() - t0) / 1000;

    const llmCalled = v2Result.trace.some((t) => t.algorithm === 'llm_extract');
    this.metrics.songMatcherV2LatencySeconds
      .labels({ tier: v2Result.tier, llm_called: String(llmCalled) })
      .observe(dt);
    if (llmCalled) {
      this.metrics.songMatcherV2LlmCallsTotal.inc({
        matched: String(v2Result.matched),
      });
    }

    if (v2Result.matched && v2Result.autoAcceptable && v2Result.song) {
      this.metrics.songMatcherV2OutcomesTotal.inc({
        outcome: 'v2_rescue',
        tier: v2Result.tier,
      });
      this.metrics.songMatcherV2RescuesTotal.inc({ tier: v2Result.tier });
      this.logger.log(
        `[v2-rescue] tier=${v2Result.tier} conf=${v2Result.confidence.toFixed(2)} ` +
          `song=${v2Result.song.id} msg="${dto.rawMessage.slice(0, 80)}"`,
      );
      return v2Result.song.id;
    }

    this.metrics.songMatcherV2OutcomesTotal.inc({
      outcome: 'both_no_match',
      tier: v2Result.tier,
    });
    return undefined;
  }

  /**
   * v1 정확/fuzzy 매칭만 호출. v1 SongMatcherService 직접 사용.
   * artist/title 모두 비어있으면 매칭 불가 → undefined.
   */
  private async tryV1Match(
    channelId: number,
    rawArtist?: string,
    rawTitle?: string,
  ): Promise<number | undefined> {
    if (!rawArtist && !rawTitle) return undefined;
    try {
      if (rawArtist && rawTitle) {
        const r = await this.v1Matcher.matchSong(
          channelId,
          rawArtist,
          rawTitle,
        );
        if (r.matched && r.song) return r.song.id;
      }
      const keyword = rawTitle || rawArtist;
      if (keyword) {
        const r = await this.v1Matcher.matchByKeyword(channelId, keyword);
        if (r.matched && r.song) return r.song.id;
      }
    } catch (e) {
      this.logger.warn(
        `v1 match error channel=${channelId}: ${(e as Error)?.message ?? e}`,
      );
    }
    return undefined;
  }

  private emitChatFeedback(
    dto: FromChatSongRequestDto,
    result: { outcome: 'accepted' } | { outcome: 'rejected'; reason: string },
  ) {
    // 오버레이가 사용할 토스트 이벤트. channelId 조회 실패는 feedback 누락만 유발, 본 플로우에 영향 없음.
    void this.getChannelIdForFeedback(dto.liveSessionId).then((channelId) => {
      if (!channelId) {
        this.logger.warn(
          `emitChatFeedback: channelId not found for session ${dto.liveSessionId}`,
        );
        return;
      }
      this.logger.log(
        `emitChatFeedback: channel=${channelId} session=${dto.liveSessionId} outcome=${result.outcome}${result.outcome === 'rejected' ? ` reason="${result.reason}"` : ''}`,
      );
      this.eventEmitter.emit(SONG_REQUEST_EVENTS.CHAT_FEEDBACK, {
        channelId,
        sessionId: dto.liveSessionId,
        outcome: result.outcome,
        reason: result.outcome === 'rejected' ? result.reason : undefined,
        nickname: dto.requesterNickname,
        rawArtist: dto.rawArtist,
        rawTitle: dto.rawTitle,
        rawMessage: dto.rawMessage,
        source: dto.source,
      });
    });
  }

  private async getChannelIdForFeedback(
    liveSessionId: number,
  ): Promise<number | null> {
    const session = await this.prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      select: { channelId: true },
    });
    return session?.channelId ?? null;
  }

  /**
   * 채팅 오버레이 브로드캐스트
   * POST /v1/internal/chat-dispatcher/broadcast
   */
  @Post('broadcast')
  @HttpCode(200)
  @ApiOperation({
    summary: '채팅 메시지 WebSocket 브로드캐스트 (chat-dispatcher 전용)',
  })
  @ApiHeader({ name: 'X-Internal-Api-Key', required: true })
  async broadcast(@Body() dto: ChatBroadcastDto) {
    this.chatGateway.broadcastChatMessage({
      platform: dto.platform as StreamPlatform,
      channelId: dto.channelId,
      userId: dto.userId,
      nickname: dto.nickname,
      message: dto.message,
      type: dto.type,
      donationAmount: dto.donationAmount,
      donationNativeAmount: dto.donationNativeAmount,
      donationCurrency: dto.donationCurrency,
      timestamp: new Date(dto.timestamp),
    });
  }

  /**
   * 싱크 스트리머 랜덤 명령 (`!스트리머랜덤`).
   * dispatcher가 명령어/후원 최소 정책 후보를 파싱한 뒤 최종 검증은 backend에서 수행.
   */
  @Post('sync-streamer-random')
  @HttpCode(200)
  @ApiOperation({ summary: '싱크 스트리머 랜덤 명령 (chat-dispatcher 전용)' })
  @ApiHeader({ name: 'X-Internal-Api-Key', required: true })
  async syncStreamerRandom(@Body() dto: SyncStreamerRandomDto) {
    const sessionId = dto.sessionId ?? dto.liveSessionId;
    if (sessionId == null) {
      throw new BadRequestException('sessionId is required');
    }

    this.cleanupProcessedCommands();
    if (this.processedCommands.has(dto.streamMessageId)) {
      return { result: 'duplicate' };
    }
    this.processedCommands.set(dto.streamMessageId, Date.now());

    try {
      const result = await this.syncLiveSessionService.triggerStreamerRandom({
        sessionId,
        sourceChannelId: dto.sourceChannelId,
        requesterNickname: dto.requesterNickname,
        donationNativeAmount: dto.donationNativeAmount,
        donationCurrency: dto.donationCurrency,
      });
      return { result: 'displayed', ...result };
    } catch (err) {
      this.processedCommands.delete(dto.streamMessageId);
      throw err;
    }
  }

  /**
   * 스트리머 채팅 명령어 (pause / resume / end / play-next)
   * POST /v1/internal/chat-dispatcher/session-command
   */
  @Post('session-command')
  @HttpCode(200)
  @ApiOperation({ summary: '스트리머 채팅 명령어 (chat-dispatcher 전용)' })
  @ApiHeader({ name: 'X-Internal-Api-Key', required: true })
  async sessionCommand(@Body() dto: SessionCommandDto) {
    // 0. 중복 명령 방지 (at-least-once 재전달 대응)
    // has() → set()은 동기 연산이므로 Node.js 단일 스레드에서 atomic
    this.cleanupProcessedCommands();
    if (this.processedCommands.has(dto.streamMessageId)) {
      return { result: 'duplicate' };
    }
    this.processedCommands.set(dto.streamMessageId, Date.now());

    try {
      return await this.verifyAndExecute(dto);
    } catch (err) {
      // 검증 또는 실행 실패 시 dedup cache에서 제거 → 재전달 시 재시도 가능
      this.processedCommands.delete(dto.streamMessageId);
      throw err;
    }
  }

  private async verifyAndExecute(dto: SessionCommandDto) {
    this.logger.log(
      `Session command received: ${dto.command} session=${dto.sessionId} ` +
        `platform=${dto.platform} user=${dto.platformUserId}`,
    );

    const operator = await resolveChannelOperator(this.prisma, {
      platform: dto.platform,
      platformUserId: dto.platformUserId,
      sessionId: dto.sessionId,
      role: { kind: 'owner-or-manager', permissionKey: 'canManageSettings' },
    });

    this.logger.log(
      `Executing: ${dto.command} session=${operator.sessionId} ` +
        `userId=${operator.userId} isOwner=${operator.isOwner}`,
    );
    const result = await this.executeCommand(
      dto.command,
      operator.sessionId,
      operator.userId,
    );
    this.logger.log(`Result: ${JSON.stringify(result)}`);
    return result;
  }

  private async executeCommand(
    command: string,
    sessionId: number,
    userId: number,
  ) {
    switch (command) {
      case 'pause':
        await this.sessionService.updateSettings(sessionId, userId, {
          paused: true,
        });
        return { result: 'paused' };
      case 'resume':
        await this.sessionService.updateSettings(sessionId, userId, {
          paused: false,
        });
        return { result: 'resumed' };
      case 'end':
        await this.sessionService.endSession(sessionId, userId);
        return { result: 'ended' };
      case 'play-next': {
        // playNext() 내부에서 세션 ACTIVE 상태를 검증 — end와의 레이스 방지
        const next = await this.songRequestService.playNext(sessionId);
        return {
          result: 'play-next',
          nextSong: next ? { id: next.id, title: next.rawTitle } : null,
        };
      }
      default:
        throw new BadRequestException(`Unknown command: ${command}`);
    }
  }

  private cleanupProcessedCommands(): void {
    const now = Date.now();
    for (const [key, ts] of this.processedCommands) {
      if (now - ts > InternalChatDispatcherController.DEDUP_TTL_MS) {
        this.processedCommands.delete(key);
      }
    }
    for (const [key, ts] of this.infoCommandLastFired) {
      if (now - ts > InternalChatDispatcherController.INFO_COOLDOWN_MS * 4) {
        this.infoCommandLastFired.delete(key);
      }
    }
  }

  /**
   * 정보성 채팅 명령 (help / how-to-request) — 권한 없음, 쿨다운만.
   * POST /v1/internal/chat-dispatcher/info-command
   */
  @Post('info-command')
  @HttpCode(200)
  @ApiOperation({ summary: '정보성 채팅 명령 (chat-dispatcher 전용)' })
  @ApiHeader({ name: 'X-Internal-Api-Key', required: true })
  async infoCommand(@Body() dto: InfoCommandDto) {
    this.cleanupProcessedCommands();
    if (this.processedCommands.has(dto.streamMessageId)) {
      return { result: 'duplicate' };
    }
    this.processedCommands.set(dto.streamMessageId, Date.now());

    const session = await this.prisma.liveSession.findUnique({
      where: { id: dto.sessionId },
      select: {
        id: true,
        channelId: true,
        status: true,
        channel: {
          select: {
            songRequestSettings: { select: { requestCommand: true } },
          },
        },
      },
    });
    if (!session || session.status !== 'ACTIVE') {
      return { result: 'session-inactive' };
    }

    const cooldownKey = `${dto.sessionId}:${dto.command}`;
    const now = Date.now();
    const last = this.infoCommandLastFired.get(cooldownKey);
    if (
      last &&
      now - last < InternalChatDispatcherController.INFO_COOLDOWN_MS
    ) {
      return { result: 'cooldown' };
    }
    this.infoCommandLastFired.set(cooldownKey, now);

    const requestCommand =
      session.channel?.songRequestSettings?.requestCommand ?? '!신청';
    const content = this.buildInfoContent(dto.command, requestCommand);

    this.eventEmitter.emit('overlay.info-display', {
      channelId: session.channelId,
      sessionId: session.id,
      command: dto.command,
      title: content.title,
      lines: content.lines,
      nickname: dto.nickname,
    });

    return { result: 'displayed' };
  }

  /**
   * 채팅 명령 노래책 추가 (`!노래책추가 곡명`).
   * 권한: 채널 owner 만 (매니저 X, 일단 스트리머 한정).
   *
   * 거절 케이스 모두 토스트 emit 후 정상 200 반환 (4xx로 dispatcher 재시도 유발 X).
   * 매칭 실패 / 권한 없음 / 이미 등록 / confidence 낮음 → outcome 토스트.
   */
  @Post('songbook-add')
  @HttpCode(200)
  @ApiOperation({ summary: '채팅 노래책 추가 명령 (chat-dispatcher 전용)' })
  @ApiHeader({ name: 'X-Internal-Api-Key', required: true })
  async fromChatSongbookAdd(@Body() dto: FromChatSongbookAddDto) {
    this.cleanupProcessedCommands();
    if (this.processedCommands.has(dto.streamMessageId)) {
      return { result: 'duplicate' };
    }
    this.processedCommands.set(dto.streamMessageId, Date.now());

    try {
      const operator = await resolveChannelOperator(this.prisma, {
        platform: dto.platform,
        platformUserId: dto.platformUserId,
        sessionId: dto.sessionId,
        role: { kind: 'owner-only' },
      });

      const result = await this.songbookAddService.add({
        channelId: operator.channelId,
        query: dto.query,
        requesterUserId: operator.userId,
      });

      this.emitSongbookFeedback(dto, operator.channelId, {
        outcome: 'accepted',
        title: result.title,
        artistName: result.artistName,
        confidence: result.confidence,
      });

      return {
        result: 'accepted',
        songId: result.songId,
        globalSongId: result.globalSongId,
        title: result.title,
        artistName: result.artistName,
        difficulty: result.difficulty,
        categoryId: result.categoryId,
      };
    } catch (err) {
      // handled rejection (NO_MATCH / LOW_CONFIDENCE / ALREADY_IN_SONGBOOK / 403 / 404)
      // 은 idempotent 결과 — dedup 유지해 같은 streamMessageId 재전달 시 LLM 재호출 차단.
      // 진짜 transient/unexpected error 에서만 dedup 삭제해 재시도 가능하게 둔다.
      if (!isHandledSongbookRejection(err)) {
        this.processedCommands.delete(dto.streamMessageId);
      }
      return this.handleSongbookAddError(dto, err);
    }
  }

  private handleSongbookAddError(
    dto: FromChatSongbookAddDto,
    err: unknown,
  ): { result: SongbookAddOutcome | 'error' } {
    let outcome: SongbookAddOutcome = 'error';
    let title: string | undefined;
    let artistName: string | undefined;
    let reason: string | undefined;

    if (err instanceof HttpException) {
      const body = err.getResponse();
      const code =
        typeof body === 'object' && body !== null && 'code' in body
          ? (body as { code?: string }).code
          : undefined;

      if (code === 'NO_MATCH') outcome = 'rejected_no_match';
      else if (code === 'LOW_CONFIDENCE') {
        outcome = 'low_confidence';
        const b = body as {
          candidateTitle?: string;
          candidateArtist?: string;
          confidence?: number;
        };
        title = b.candidateTitle;
        artistName = b.candidateArtist;
        reason = `confidence=${b.confidence?.toFixed?.(2) ?? '?'}`;
      } else if (code === 'ALREADY_IN_SONGBOOK') {
        outcome = 'already_exists';
        const b = body as { title?: string; artistName?: string };
        title = b.title;
        artistName = b.artistName;
      } else if (err.getStatus() === 403) {
        outcome = 'rejected_no_permission';
      } else if (err.getStatus() === 404) {
        outcome = 'rejected_no_permission';
      } else {
        outcome = 'error';
        reason = err.message;
      }
    } else if (err instanceof Error) {
      outcome = 'error';
      reason = err.message;
      this.logger.error(
        `Songbook add unexpected error session=${dto.sessionId} msg="${dto.rawMessage.slice(0, 80)}": ${err.message}`,
      );
    }

    this.emitSongbookFeedback(dto, null, {
      outcome,
      title,
      artistName,
      reason,
    });
    return { result: outcome };
  }

  /**
   * channelIdHint 가 null 이면 sessionId → channelId 조회 (no_permission/error 케이스).
   * 정상 흐름은 operator.channelId 를 그대로 넘김.
   */
  private emitSongbookFeedback(
    dto: FromChatSongbookAddDto,
    channelIdHint: number | null,
    extras: {
      outcome: SongbookAddOutcome;
      title?: string;
      artistName?: string;
      confidence?: number;
      reason?: string;
    },
  ): void {
    const resolveChannelId = async (): Promise<number | null> => {
      if (channelIdHint !== null) return channelIdHint;
      const session = await this.prisma.liveSession.findUnique({
        where: { id: dto.sessionId },
        select: { channelId: true },
      });
      return session?.channelId ?? null;
    };
    this.metrics.songbookAddOutcomesTotal.inc({ outcome: extras.outcome });
    void resolveChannelId().then((channelId) => {
      if (!channelId) {
        this.logger.warn(
          `emitSongbookFeedback: channelId not found for session ${dto.sessionId}`,
        );
        return;
      }
      const payload: SongbookAddFeedbackEvent = {
        channelId,
        sessionId: dto.sessionId,
        outcome: extras.outcome,
        nickname: dto.nickname,
        query: dto.query,
        title: extras.title,
        artistName: extras.artistName,
        confidence: extras.confidence,
        reason: extras.reason,
      };
      this.logger.log(
        `Songbook feedback: channel=${channelId} session=${dto.sessionId} outcome=${extras.outcome}`,
      );
      this.eventEmitter.emit(SONGBOOK_ADD_EVENTS.FEEDBACK, payload);
    });
  }

  // helpers --------------------------------------------------------

  private buildInfoContent(
    _command: 'help' | 'how-to-request',
    requestCommand: string,
  ): { title: string; lines: string[] } {
    // help / how-to-request 모두 동일 컨텐츠 — 신청 가능한 4개 경로 안내.
    return {
      title: '신청 방법',
      lines: [
        `채팅신청: ${requestCommand} 가수 - 노래제목`,
        `후원신청: 후원 메세지에 ${requestCommand} 가수 - 노래제목`,
        '웹신청: 멜로밍 웹사이트에서 신청',
        '앱신청: 멜로밍 앱에서 신청',
      ],
    };
  }
}

/**
 * songbook-add 흐름의 "정상적으로 처리된 거절" 분류.
 *
 * 이 분류에 해당하면 dedup Map 에서 streamMessageId 를 삭제하지 않는다 — 같은
 * 메시지 재전달 시 LLM 재호출/토스트 재발 방지. transient/unexpected error (DB
 * down 등) 에서만 dedup 삭제해 재시도 가능하게 둔다.
 */
function isHandledSongbookRejection(err: unknown): boolean {
  if (!(err instanceof HttpException)) return false;
  const status = err.getStatus();
  if (status === 403 || status === 404) return true;
  if (status === 400 || status === 409) {
    const body = err.getResponse();
    if (typeof body !== 'object' || body === null) return false;
    const code = (body as { code?: string }).code;
    return (
      code === 'NO_MATCH' ||
      code === 'LOW_CONFIDENCE' ||
      code === 'ALREADY_IN_SONGBOOK'
    );
  }
  return false;
}
