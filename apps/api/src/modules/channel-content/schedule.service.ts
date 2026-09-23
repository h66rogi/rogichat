import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ScheduleStatus, type ScheduleVisibility } from '../../generated/prisma/client.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { SessionCredentials, CommandCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { toWhereOverlap, kstMonthRange } from './upstream/schedule-range.js';
import { nextChannelContentId } from './channel-content-id.js';

type ScheduleInput = {
  title?: string; content?: string | null; startAt?: string; endAt?: string | null;
  allDay?: boolean; visibility?: ScheduleVisibility; status?: ScheduleStatus;
  location?: string | null; externalUrl?: string | null; isCanceled?: boolean;
};
type ScheduleQuery = { ym?: string; from?: string; to?: string; page?: number; limit?: number };

function input(value: unknown, create: boolean): ScheduleInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
  const row = value as Record<string, unknown>;
  const allowed = ['title','content','startAt','endAt','allDay','visibility','status','location','externalUrl','isCanceled'];
  if (Object.keys(row).some(key => !allowed.includes(key))) throw new ApiError('INVALID_REQUEST', 400);
  const text = (key: string, max: number, nullable = false): string | null | undefined => {
    const v = row[key];
    if (v === undefined) return undefined;
    if (v === null && nullable) return null;
    if (typeof v !== 'string' || v.length > max) throw new ApiError('INVALID_REQUEST', 400);
    return v.trim();
  };
  const title = text('title',100);
  const content = text('content',10000,true);
  const startAt = text('startAt',40);
  const endAt = text('endAt',40,true);
  const location = text('location',255,true);
  const externalUrl = text('externalUrl',500,true);
  if ((create && (!title || !startAt)) || (title !== undefined && !title) || startAt === null) throw new ApiError('INVALID_REQUEST', 400);
  for (const key of ['allDay','isCanceled']) if (row[key] !== undefined && typeof row[key] !== 'boolean') throw new ApiError('INVALID_REQUEST', 400);
  if (row.visibility !== undefined && !['PUBLIC','PRIVATE'].includes(String(row.visibility))) throw new ApiError('INVALID_REQUEST', 400);
  if (row.status !== undefined && !['LIVE','COLLAB','OFF','ETC','TBD'].includes(String(row.status))) throw new ApiError('INVALID_REQUEST', 400);
  const parseDate = (v: string | null | undefined) => v === null || v === undefined ? undefined : new Date(v);
  const start = parseDate(startAt), end = parseDate(endAt);
  if ((start && !Number.isFinite(start.valueOf())) || (end && !Number.isFinite(end.valueOf())) || (start && end && start > end)) throw new ApiError('INVALID_REQUEST', 400);
  if (externalUrl && (!/^https?:\/\//.test(externalUrl) || !URL.canParse(externalUrl))) throw new ApiError('INVALID_REQUEST', 400);
  return { ...(title !== undefined ? { title } : {}), ...(content !== undefined ? { content } : {}),
    ...(startAt !== undefined ? { startAt: startAt as string } : {}), ...(endAt !== undefined ? { endAt } : {}),
    ...(location !== undefined ? { location } : {}), ...(externalUrl !== undefined ? { externalUrl } : {}),
    ...(row.allDay !== undefined ? { allDay: row.allDay as boolean } : {}),
    ...(row.isCanceled !== undefined ? { isCanceled: row.isCanceled as boolean } : {}),
    ...(row.visibility !== undefined ? { visibility: row.visibility as ScheduleVisibility } : {}),
    ...(row.status !== undefined ? { status: row.status as ScheduleStatus } : {}) };
}

function dates(value: ScheduleInput): Prisma.ChannelScheduleUncheckedUpdateInput {
  return { ...value, ...(value.startAt ? { startAt: new Date(value.startAt) } : {}),
    ...(value.endAt !== undefined ? { endAt: value.endAt ? new Date(value.endAt) : null } : {}) };
}

const scheduleSelect = {
  id: true, channelId: true, authorUserId: true, title: true, content: true,
  startAt: true, endAt: true, allDay: true, isCanceled: true, status: true,
  visibility: true, location: true, externalUrl: true, createdAt: true, updatedAt: true,
  author: { select: { profile: { select: { nickname: true } } } },
} satisfies Prisma.ChannelScheduleSelect;

type ScheduleRow = Prisma.ChannelScheduleGetPayload<{ select: typeof scheduleSelect }>;
function response(row: ScheduleRow) {
  return { id: row.id, channelId: row.channelId, channelWebPath: 'hurogi',
    author: { id: row.authorUserId, nickname: row.author.profile?.nickname ?? '후로기', profileImageUrl: null },
    channel: { id: row.channelId, name: '후로기', profileImageUrl: null, webPath: 'hurogi' },
    title: row.title, content: row.content, startAt: row.startAt.toISOString(), endAt: row.endAt?.toISOString() ?? null,
    allDay: row.allDay, isCanceled: row.isCanceled, status: row.status, visibility: row.visibility,
    location: row.location, externalUrl: row.externalUrl, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/** Meloming ChannelSchedule contract and overlap/pagination behavior on Rogichat's room key. */
@Injectable()
export class ChannelScheduleService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  list(query: ScheduleQuery) {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const page = Math.max(1, Math.min(100000, query.page ?? 1));
      const limit = Math.max(1, Math.min(100, query.limit ?? 40));
      const month = query.ym ? kstMonthRange(query.ym) : undefined;
      const overlap = month ? toWhereOverlap(month.from, month.to) : toWhereOverlap(query.from, query.to);
      const where: Prisma.ChannelScheduleWhereInput = { channelId: roomId, isDeleted: false, visibility: 'PUBLIC', ...overlap };
      const [rows,total] = await Promise.all([
        tx.prisma.channelSchedule.findMany({ where, select: scheduleSelect, orderBy: { startAt: 'desc' }, skip: (page-1)*limit, take: limit }),
        tx.prisma.channelSchedule.count({ where }),
      ]);
      return { items: rows.map(response), page, limit, total };
    });
  }

  manage(credentials: SessionCredentials, query: ScheduleQuery) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      const page = Math.max(1, query.page ?? 1), limit = Math.max(1, Math.min(100,query.limit ?? 40));
      const month = query.ym ? kstMonthRange(query.ym) : undefined;
      const overlap = month ? toWhereOverlap(month.from,month.to) : toWhereOverlap(query.from,query.to);
      const where: Prisma.ChannelScheduleWhereInput = { channelId: roomId, isDeleted: false, ...overlap };
      const [rows,total] = await Promise.all([
        tx.prisma.channelSchedule.findMany({ where, select: scheduleSelect, orderBy: { startAt: 'desc' }, skip: (page-1)*limit, take: limit }),
        tx.prisma.channelSchedule.count({ where }),
      ]);
      return { items: rows.map(response), page, limit, total };
    });
  }

  create(credentials: CommandCredentials, body: unknown) {
    const parsed = input(body, true);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      const data: Prisma.ChannelScheduleUncheckedCreateInput = { id:await nextChannelContentId(tx.prisma),channelId: roomId, authorUserId: actor.userId,
        title: parsed.title!, startAt: new Date(parsed.startAt!),
        ...(parsed.content !== undefined ? { content: parsed.content } : {}),
        ...(parsed.endAt !== undefined ? { endAt: parsed.endAt ? new Date(parsed.endAt) : null } : {}),
        ...(parsed.allDay !== undefined ? { allDay: parsed.allDay } : {}),
        ...(parsed.visibility !== undefined ? { visibility: parsed.visibility } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.location !== undefined ? { location: parsed.location } : {}),
        ...(parsed.externalUrl !== undefined ? { externalUrl: parsed.externalUrl } : {}),
        ...(parsed.isCanceled !== undefined ? { isCanceled: parsed.isCanceled } : {}) };
      const row = await tx.prisma.channelSchedule.create({ data, select: scheduleSelect });
      return response(row);
    });
  }

  update(credentials: CommandCredentials, id: number, body: unknown) {
    const parsed = input(body, false);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      const existing = await tx.prisma.channelSchedule.findFirst({ where: { id, channelId: roomId, isDeleted: false }, select: { id: true, startAt: true, endAt: true } });
      if (!existing) throw new ApiError('NOT_FOUND',404);
      const start = parsed.startAt ? new Date(parsed.startAt) : existing.startAt;
      const end = parsed.endAt === undefined ? existing.endAt : parsed.endAt ? new Date(parsed.endAt) : null;
      if (end && start > end) throw new ApiError('INVALID_REQUEST',400);
      const row = await tx.prisma.channelSchedule.update({ where: { id }, data: { ...dates(parsed), recurringScheduleId: null }, select: scheduleSelect });
      return response(row);
    });
  }

  remove(credentials: CommandCredentials, id: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      const changed = await tx.prisma.channelSchedule.updateMany({ where: { id, channelId: roomId, isDeleted: false }, data: { isDeleted: true, deletedAt: new Date() } });
      if (changed.count !== 1) throw new ApiError('NOT_FOUND',404);
    });
  }
}
