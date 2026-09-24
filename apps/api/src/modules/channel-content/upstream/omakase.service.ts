import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LiveSessionType, OmakaseLedgerType, Prisma } from '../../../generated/prisma/client.js';
import type { OmakaseLedgerEntry } from '../../../generated/prisma/client.js';
import { nextChannelContentId } from '../channel-content-id.js';
import { SongRequestService } from './song-request.service.js';

type OmakaseStatusDto = {channelId:number;enabled:boolean;displayName:string;price:number;
  currencyPrices:Record<string,number|null>|null;count:number};
type OmakaseLedgerResponseDto = {id:number;channelId:number;liveSessionId:number|null;songRequestId:number|null;
  type:OmakaseLedgerType;delta:number;balanceAfter:number;requesterPlatformId:string|null;
  requesterNickname:string|null;rawMessage:string|null;donationAmount:number|null;
  donationNativeAmount:number|null;donationCurrency:string|null;actorUserId:string|null;
  reason:string|null;createdAt:Date};
type UpdateOmakaseSettingsDto = Partial<{enabled:boolean;displayName:string|null;price:number;
  currencyPrices:Record<string,number|null>|null}>;
type CreateSongRequestDto = {liveSessionId:number;songId?:number;rawArtist:string;rawTitle:string;
  rawMessage?:string;requestType?:'NORMAL'|'RANDOM';position?:'FRONT'|'BACK'|'AFTER';afterRequestId?:number};
type Operator = {userId:string;nickname:string;alias:number;operator:boolean};

type OmakaseSettingsRow = {
  channelId: string;
  enabled: boolean;
  displayName: string | null;
  price: number;
  currencyPrices: Prisma.JsonValue | null;
  count: number;
};

export class OmakaseService {
  constructor(private readonly prisma: Prisma.TransactionClient,private readonly channelId:string) {}

  private async inTransaction<T>(callback:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
    return callback(this.prisma);
  }

  static defaultDisplayName(channelName: string | null | undefined): string {
    const first = (channelName ?? '').trim().charAt(0);
    return /^[가-힣]$/u.test(first) ? `${first}마카세` : '오마카세';
  }

  async getStatus(channelId: string): Promise<OmakaseStatusDto> {
    const settings = await this.getOrCreateSettings(channelId);
    return this.toStatusDto(settings);
  }

  async updateSettings(
    channelId: string,
    dto: UpdateOmakaseSettingsDto,
  ): Promise<OmakaseStatusDto> {
    const data: Prisma.ChannelOmakaseSettingsUpdateInput = {};
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.displayName !== undefined) {
      const trimmed = dto.displayName?.trim() ?? '';
      data.displayName = trimmed === '' ? null : trimmed;
    }
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.currencyPrices !== undefined) {
      data.currencyPrices = this.sanitizeCurrencyPrices(dto.currencyPrices);
    }

    await this.getOrCreateSettings(channelId);
    const updated = await this.inTransaction(async (tx) => {
      const settings = await tx.channelOmakaseSettings.update({
        where: { channelId },
        data,
      });
      const sessions = await tx.liveSession.findMany({
        where: {
          channelId,
          status: 'ACTIVE',
          sessionType: LiveSessionType.STANDARD,
        },
        select: { id: true },
      });
      for (const session of sessions) {
        await tx.liveSession.update({where:{id:session.id},data:{playbackRevision:{increment:1}}});
      }
      return settings;
    });
    const status = await this.toStatusDto(updated);
    await this.emitUpdated(channelId, undefined, status);
    return status;
  }

  async listHistory(
    channelId: string,
    limit = 50,
  ): Promise<OmakaseLedgerResponseDto[]> {
    const rows = await this.prisma.omakaseLedgerEntry.findMany({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((row) => this.toLedgerDto(row));
  }

  async manualAdjust(params: {
    channelId: string;
    liveSessionId: number;
    delta: number;
    actorUserId: string | null;
    reason?: string;
  }): Promise<OmakaseStatusDto> {
    if (params.delta === 0) {
      return this.getStatus(params.channelId);
    }
    await this.validateSession(params.liveSessionId, params.channelId);
    return this.changeCount({
      channelId: params.channelId,
      liveSessionId: params.liveSessionId,
      delta: params.delta,
      type:
        params.delta > 0
          ? OmakaseLedgerType.MANUAL_INCREMENT
          : OmakaseLedgerType.MANUAL_DECREMENT,
      actorUserId: params.actorUserId,
      reason: params.reason ?? null,
    });
  }

  async setCount(params: {
    channelId: string;
    liveSessionId: number;
    count: number;
    actorUserId: string | null;
    reason?: string;
  }): Promise<OmakaseStatusDto> {
    await this.validateSession(params.liveSessionId, params.channelId);
    await this.getOrCreateSettings(params.channelId);
    const status = await this.inTransaction(async (tx) => {
      const settings = await tx.channelOmakaseSettings.findUniqueOrThrow({
        where: { channelId: params.channelId },
      });
      const delta = params.count - settings.count;
      const updated = await tx.channelOmakaseSettings.update({
        where: { channelId: params.channelId },
        data: { count: params.count },
      });
      if (delta !== 0) {
        await tx.omakaseLedgerEntry.create({
          data: {
            id:await nextChannelContentId(tx),
            channelId: params.channelId,
            liveSessionId: params.liveSessionId,
            delta,
            balanceAfter: params.count,
            type: OmakaseLedgerType.MANUAL_SET,
            actorUserId: params.actorUserId,
            reason: params.reason ?? null,
          },
        });
        // 오마카세 개수 변화 → overlay omakase 위젯 count 변경 → revision bump (GATE 0).
        await tx.liveSession.update({where:{id:params.liveSessionId},data:{playbackRevision:{increment:1}}});
      }
      return this.toStatusDto(updated);
    });
    await this.emitUpdated(params.channelId, params.liveSessionId, status);
    return status;
  }

  async consumeWithSongRequest(params: {
    channelId: string;
    actorUserId: string | null;
    request: CreateSongRequestDto;
    playNow?: boolean;
    actor:Operator;
  }): Promise<{ status: OmakaseStatusDto; request: unknown }> {
    await this.validateSession(params.request.liveSessionId, params.channelId);
    const current = await this.getStatus(params.channelId);
    if (!current.enabled) {
      throw new BadRequestException('오마카세가 꺼져 있습니다.');
    }
    if (current.count <= 0) {
      throw new ConflictException('사용 가능한 오마카세가 없습니다.');
    }

    const created = await new SongRequestService(this.prisma,params.channelId).createRequest(
      params.request,params.actor,
    );
    const request =
      params.playNow === true
        ? await new SongRequestService(this.prisma,params.channelId).playNow((created as { id: number }).id)
        : created;

    const status = await this.changeCount({
      channelId: params.channelId,
      liveSessionId: params.request.liveSessionId,
      songRequestId: (created as { id: number }).id,
      delta: -1,
      type:
        params.playNow === true
          ? OmakaseLedgerType.CONSUME_PLAY_NOW
          : OmakaseLedgerType.CONSUME_QUEUE,
      actorUserId: params.actorUserId,
    });

    return { status, request };
  }

  private async getOrCreateSettings(
    channelId: string,
  ): Promise<OmakaseSettingsRow> {
    if (channelId !== this.channelId) throw new NotFoundException('채널을 찾을 수 없습니다.');
    const existing = await this.prisma.channelOmakaseSettings.findUnique({
      where: { channelId },
    });
    if (existing) return existing;

    const channel = await this.prisma.rooms.findUnique({
      where: { id: channelId },
      select: { name: true },
    });
    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }
    const displayName = OmakaseService.defaultDisplayName(channel.name);

    try {
      return await this.prisma.channelOmakaseSettings.create({
        data: { id:await nextChannelContentId(this.prisma),channelId,displayName },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const refreshed = await this.prisma.channelOmakaseSettings.findUnique({
          where: { channelId },
        });
        if (refreshed) return refreshed;
      }
      throw e;
    }
  }

  private async changeCount(params: {
    channelId: string;
    liveSessionId?: number | null;
    songRequestId?: number | null;
    delta: number;
    type: OmakaseLedgerType;
    actorUserId?: string | null;
    reason?: string | null;
  }): Promise<OmakaseStatusDto> {
    if (params.delta === 0) {
      return this.getStatus(params.channelId);
    }

    const status = await this.inTransaction(async (tx) => {
      const settings = await tx.channelOmakaseSettings.findUnique({
        where: { channelId: params.channelId },
      });
      if (!settings) {
        throw new NotFoundException('오마카세 설정을 찾을 수 없습니다.');
      }

      const nextCount = settings.count + params.delta;
      if (nextCount < 0) {
        throw new ConflictException('오마카세 개수는 0보다 작을 수 없습니다.');
      }

      const updated = await tx.channelOmakaseSettings.update({
        where: { channelId: params.channelId },
        data: { count: nextCount },
      });

      await tx.omakaseLedgerEntry.create({
        data: {
          id:await nextChannelContentId(tx),
          channelId: params.channelId,
          liveSessionId: params.liveSessionId ?? null,
          songRequestId: params.songRequestId ?? null,
          delta: params.delta,
          balanceAfter: nextCount,
          type: params.type,
          actorUserId: params.actorUserId ?? null,
          reason: params.reason ?? null,
        },
      });

      // 오마카세 개수 변화는 overlay omakase 위젯의 count 를 바꾸므로 revision bump (GATE 0).
      if (params.liveSessionId != null) {
        await tx.liveSession.update({where:{id:params.liveSessionId},data:{playbackRevision:{increment:1}}});
      }

      return this.toStatusDto(updated);
    });

    await this.emitUpdated(params.channelId, params.liveSessionId, status);
    return status;
  }

  private async validateSession(
    liveSessionId: number,
    channelId: string,
  ): Promise<void> {
    const session = await this.prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      select: { channelId: true },
    });
    if (!session || session.channelId !== channelId || channelId !== this.channelId) {
      throw new BadRequestException('이 채널의 라이브 세션이 아닙니다.');
    }
  }

  private async toStatusDto(
    settings: OmakaseSettingsRow,
  ): Promise<OmakaseStatusDto> {
    let displayName = settings.displayName;
    if (!displayName) {
      const channel = await this.prisma.rooms.findUnique({
        where: { id: settings.channelId },
        select: { name: true },
      });
      displayName = OmakaseService.defaultDisplayName(channel?.name);
    }
    return {
      channelId: 1,
      enabled: settings.enabled,
      displayName,
      price: settings.price ?? 0,
      currencyPrices: this.normalizeCurrencyPrices(settings.currencyPrices),
      count: settings.count,
    };
  }

  private toLedgerDto(row: OmakaseLedgerEntry): OmakaseLedgerResponseDto {
    return {
      id: row.id,
      channelId: 1,
      liveSessionId: row.liveSessionId,
      songRequestId: row.songRequestId,
      type: row.type,
      delta: row.delta,
      balanceAfter: row.balanceAfter,
      requesterPlatformId: row.requesterPlatformId,
      requesterNickname: row.requesterNickname,
      rawMessage: row.rawMessage,
      donationAmount: row.donationAmount,
      donationNativeAmount: row.donationNativeAmount,
      donationCurrency: row.donationCurrency,
      actorUserId: row.actorUserId,
      reason: row.reason,
      createdAt: row.createdAt,
    };
  }

  private sanitizeCurrencyPrices(
    value: Record<string, number | null> | null,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (!value) return Prisma.JsonNull;
    const out: Record<string, number | null> = {};
    for (const [rawKey, rawPrice] of Object.entries(value)) {
      const key = rawKey.trim();
      if (!key) continue;
      if (rawPrice === null) {
        out[key] = null;
      } else if (Number.isFinite(rawPrice) && rawPrice >= 0) {
        out[key] = Math.floor(rawPrice);
      }
    }
    return out;
  }

  private normalizeCurrencyPrices(
    value: Prisma.JsonValue | null,
  ): Record<string, number | null> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const out: Record<string, number | null> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (raw === null) {
        out[key] = null;
      } else if (typeof raw === 'number' && Number.isFinite(raw)) {
        out[key] = Math.max(0, Math.floor(raw));
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  private async emitUpdated(channelId:string,liveSessionId:number|null|undefined,status:OmakaseStatusDto):Promise<void> {
    void channelId;void liveSessionId;void status;
  }
}
