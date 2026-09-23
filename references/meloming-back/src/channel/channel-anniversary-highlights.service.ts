import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  calculateBirthdayDdayFromDate,
  calculateMilestonesFromDate,
  getUpcomingEventDateIso,
} from './utils/channel-anniversary.utils';
import type {
  UpcomingAnniversaryHighlightDto,
  UpcomingAnniversaryType,
} from './dto/upcoming-anniversary-highlights.response.dto';
import type { UpcomingHighlightsOrder } from './dto/upcoming-anniversary-highlights.query.dto';

interface UpcomingAnniversaryEvent {
  channelId: number;
  channelName: string;
  webPath: string;
  profileImageUrl: string | null;
  themeColor: string | null;
  type: UpcomingAnniversaryType;
  label: string;
  date: string;
  daysUntil: number;
  isOwnerProSubscriber: boolean;
  isOwnerAmbassador: boolean;
}

/**
 * 프로 구독 활성 상태 확인
 */
function isProSubscriptionActive(user: {
  isProSubscriber: boolean | null;
  proSubscriptionEndAt: Date | null;
}): boolean {
  if (!user.isProSubscriber) return false;
  if (!user.proSubscriptionEndAt) return false;
  return user.proSubscriptionEndAt > new Date();
}

function kstYmd(now: Date = new Date()): string {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10);
}

function hashSeedToUint32(seed: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function stableShuffle<T>(items: T[], seedString: string): T[] {
  const rand = mulberry32(hashSeedToUint32(seedString));
  const arr = items.slice();
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

@Injectable()
export class ChannelAnniversaryHighlightsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUpcomingHighlights(params: {
    days: number;
    limit: number;
    order: UpcomingHighlightsOrder;
    seed?: string;
  }): Promise<{ items: UpcomingAnniversaryHighlightDto[] }> {
    const { days, limit, order, seed } = params;

    // profile이 없으면 생일/데뷔일도 없으므로 제외해도 무방
    const channels = await this.prisma.channel.findMany({
      where: {
        profile: {
          isNot: null,
        },
      },
      select: {
        id: true,
        name: true,
        webPath: true,
        profileImageUrl: true,
        themeColor: true,
        user: {
          select: {
            isProSubscriber: true,
            proSubscriptionEndAt: true,
            isAmbassador: true,
          },
        },
        profile: {
          select: {
            birthday: true,
            debutDate: true,
          },
        },
      },
    });

    const now = new Date();
    const events: UpcomingAnniversaryEvent[] = [];

    for (const ch of channels) {
      const profile = ch.profile;
      if (!profile) continue;

      const ownerProSubscriber = ch.user
        ? isProSubscriptionActive(ch.user)
        : false;
      const ownerAmbassador = !!(ch.user as any)?.isAmbassador;

      if (profile.birthday) {
        const birthday = calculateBirthdayDdayFromDate(profile.birthday, now);
        if (
          birthday.daysUntilBirthday >= 0 &&
          birthday.daysUntilBirthday <= days
        ) {
          const label = `생일 (${birthday.birthdayDate})`;
          const daysUntil = birthday.daysUntilBirthday;
          const date = getUpcomingEventDateIso(daysUntil, now);
          events.push({
            channelId: ch.id,
            channelName: ch.name,
            webPath: ch.webPath,
            profileImageUrl: ch.profileImageUrl ?? null,
            themeColor: ch.themeColor ?? null,
            type: 'birthday',
            label,
            date,
            daysUntil,
            isOwnerProSubscriber: ownerProSubscriber,
            isOwnerAmbassador: ownerAmbassador,
          });
        }
      }

      if (profile.debutDate) {
        const milestones = calculateMilestonesFromDate(profile.debutDate, now);
        if (
          milestones.daysToMilestone >= 0 &&
          milestones.daysToMilestone <= days
        ) {
          const label = milestones.nextMilestone;
          const daysUntil = milestones.daysToMilestone;
          const date = getUpcomingEventDateIso(daysUntil, now);
          events.push({
            channelId: ch.id,
            channelName: ch.name,
            webPath: ch.webPath,
            profileImageUrl: ch.profileImageUrl ?? null,
            themeColor: ch.themeColor ?? null,
            type: 'broadcast',
            label,
            date,
            daysUntil,
            isOwnerProSubscriber: ownerProSubscriber,
            isOwnerAmbassador: ownerAmbassador,
          });
        }
      }
    }

    // 기본 정렬(안정성): 날짜 오름차순 + (channelId/type)로 타이브레이크
    const baseSorted = events
      .slice()
      .sort(
        (a, b) =>
          a.daysUntil - b.daysUntil ||
          a.channelId - b.channelId ||
          a.type.localeCompare(b.type),
      );

    const seeded = seed && seed.trim().length > 0 ? seed.trim() : kstYmd(now);

    const ordered =
      order === 'random' ? stableShuffle(baseSorted, seeded) : baseSorted;

    const items: UpcomingAnniversaryHighlightDto[] = ordered
      .slice(0, limit)
      .map((e) => ({
        id: `${e.type}:${e.channelId}:${e.date}`,
        channelId: e.channelId,
        channelName: e.channelName,
        webPath: e.webPath,
        profileImageUrl: e.profileImageUrl,
        themeColor: e.themeColor,
        type: e.type,
        label: e.label,
        date: e.date,
        daysUntil: e.daysUntil,
        isOwnerProSubscriber: e.isOwnerProSubscriber,
        isOwnerAmbassador: e.isOwnerAmbassador,
      }));

    return { items };
  }
}
