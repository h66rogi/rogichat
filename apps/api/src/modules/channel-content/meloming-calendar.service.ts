import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { ChannelScheduleService } from './schedule.service.js';
import { expandBirthdayInRange, expandMilestonesInRange } from './upstream/channel-anniversary-range.utils.js';

type CalendarQuery = {
  from: string; to: string; q?: string; limit?: number;
  includeSchedules?: boolean; includeAnniversaries?: boolean;
  includeBroadcasts?: boolean; includeSetlists?: boolean; includeClips?: boolean;
};
type CalendarAnniversary = { id: null; source: 'AUTO'; type: 'BIRTHDAY' | 'BROADCAST_MILESTONE'; title: string; date: string };
type CalendarSearchItem = {
  type: 'SCHEDULE' | 'ANNIVERSARY'; date: string; title: string; subtitle: string | null;
  scheduleId: number | null; sessionKey: null; sessionId: null; clipId: null; anniversaryType: string | null;
};

/** Meloming ChannelCalendarService, bound to Rogichat's owner room and selected schedule/anniversary sources. */
@Injectable()
export class MelomingCalendarService {
  private readonly logger = new Logger(MelomingCalendarService.name);
  static readonly MAX_RANGE_MS_403D = 403 * 24 * 60 * 60 * 1000;

  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
    @Inject(ChannelScheduleService) private readonly schedules: ChannelScheduleService,
  ) {}

  private parseAndValidateWindow(from: string, to: string): { fromDate: Date; toDate: Date } {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) ||
      toDate.getTime() <= fromDate.getTime() ||
      toDate.getTime() - fromDate.getTime() > MelomingCalendarService.MAX_RANGE_MS_403D) {
      throw new ApiError('INVALID_REQUEST', 400);
    }
    return { fromDate, toDate };
  }

  private fetchAnniversaries(profile: { birthday: Date | null; debutDate: Date | null } | null,
    from: Date, to: Date): CalendarAnniversary[] {
    if (!profile) return [];
    const items: CalendarAnniversary[] = [];
    if (profile.debutDate) {
      const milestones = expandMilestonesInRange(profile.debutDate, from, to);
      for (const m of milestones) items.push({ id: null, source: 'AUTO', type: 'BROADCAST_MILESTONE', title: m.title, date: m.date.toISOString() });
    }
    if (profile.birthday) {
      const birthdays = expandBirthdayInRange(profile.birthday, from, to);
      for (const b of birthdays) items.push({ id: null, source: 'AUTO', type: 'BIRTHDAY', title: b.title, date: b.date.toISOString() });
    }
    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  }

  private unwrap<T>(result: PromiseSettledResult<T[]>, sourceLabel: string): T[] {
    if (result.status === 'fulfilled') return result.value;
    const reason = result.reason;
    this.logger.error(`unified-calendar ${sourceLabel} fetch failed — falling back to empty: ${reason instanceof Error ? reason.message : String(reason)}`);
    return [];
  }

  async getCalendar(query: CalendarQuery, credentials: SessionCredentials) {
    const { fromDate, toDate } = this.parseAndValidateWindow(query.from, query.to);
    const [schedulesResult, anniversariesResult] = await Promise.allSettled([
      query.includeSchedules === false ? Promise.resolve([]) : this.schedules.listForViewer(credentials, { from: query.from, to: query.to, page: 1, limit: 500 }).then(r => r.items),
      query.includeAnniversaries === false ? Promise.resolve([] as CalendarAnniversary[]) : this.transactions.read(async tx => {
        const { roomId } = await this.repository.primary(tx);
        return this.fetchAnniversaries(await tx.prisma.channelProfile.findUnique({ where: { channelId: roomId }, select: { birthday: true, debutDate: true } }), fromDate, toDate);
      }),
    ]);
    return {
      channelId: '1', range: { from: query.from, to: query.to },
      schedules: this.unwrap(schedulesResult, 'schedules'), broadcasts: [], setlists: [],
      anniversaries: this.unwrap(anniversariesResult, 'anniversaries'), clips: [],
    };
  }

  async searchCalendar(query: CalendarQuery, credentials: SessionCredentials) {
    const { fromDate, toDate } = this.parseAndValidateWindow(query.from, query.to);
    const term = (query.q ?? '').trim();
    const baseResponse = { channelId: '1', query: query.q ?? '', range: { from: query.from, to: query.to } };
    if (!term) return { ...baseResponse, total: 0, items: [] };
    const perType = query.limit && query.limit > 0 ? Math.min(query.limit, 50) : 20;
    const [schedulesResult, anniversariesResult] = await Promise.allSettled([
      query.includeSchedules === false ? Promise.resolve([] as CalendarSearchItem[]) : this.searchSchedules(fromDate, toDate, term, credentials),
      query.includeAnniversaries === false ? Promise.resolve([] as CalendarSearchItem[]) : this.transactions.read(async tx => {
        const { roomId } = await this.repository.primary(tx);
        const profile = await tx.prisma.channelProfile.findUnique({ where: { channelId: roomId }, select: { birthday: true, debutDate: true } });
        return this.fetchAnniversaries(profile, fromDate, toDate)
          .filter(a => a.title.toLowerCase().includes(term.toLowerCase()))
          .map((a): CalendarSearchItem => ({ type: 'ANNIVERSARY', date: a.date, title: a.title,
            subtitle: a.type === 'BIRTHDAY' ? '생일' : '기념일', scheduleId: null,
            sessionKey: null, sessionId: null, clipId: null, anniversaryType: a.type }));
      }),
    ]);
    const merged = [ ...this.unwrap(schedulesResult, 'search:schedules'), ...this.unwrap(anniversariesResult, 'search:anniversaries') ];
    merged.sort((a, b) => b.date.localeCompare(a.date));
    const countByType = new Map<string, number>();
    const items: CalendarSearchItem[] = [];
    for (const it of merged) {
      const n = countByType.get(it.type) ?? 0;
      if (n >= perType) continue;
      countByType.set(it.type, n + 1);
      items.push(it);
    }
    return { ...baseResponse, total: merged.length, items };
  }

  private async searchSchedules(from: Date, to: Date, term: string, credentials: SessionCredentials): Promise<CalendarSearchItem[]> {
    return this.transactions.read(async tx => {
      const { roomId, ownerId } = await this.repository.primary(tx);
      const actor = credentials.token ? await this.auth.require(tx, credentials, true) : null;
      const includePrivate = actor?.userId === ownerId;
      const rows = await tx.prisma.channelSchedule.findMany({
        where: { channelId: roomId, isDeleted: false, ...(includePrivate ? {} : { visibility: 'PUBLIC' as const }),
          AND: [
            { OR: [{ AND: [{ startAt: { lt: to } }, { endAt: { gte: from } }] }, { AND: [{ startAt: { gte: from, lt: to } }, { endAt: null }] }] },
            { OR: [{ title: { contains: term } }, { content: { contains: term } }, { location: { contains: term } }] },
          ] } satisfies Prisma.ChannelScheduleWhereInput,
        orderBy: { startAt: 'desc' }, take: 100,
        select: { id: true, title: true, content: true, location: true, startAt: true },
      });
      return rows.map((r): CalendarSearchItem => ({ type: 'SCHEDULE', date: r.startAt.toISOString(), title: r.title,
        subtitle: r.location ?? this.snippet(r.content), scheduleId: r.id,
        sessionKey: null, sessionId: null, clipId: null, anniversaryType: null }));
    });
  }

  private snippet(value: string | null, max = 60): string | null {
    if (!value) return null;
    const text = value.trim();
    return text.length > max ? `${text.slice(0, max)}...` : text || null;
  }
}
