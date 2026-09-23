import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type ChannelProfile, type Gender, type MBTI } from '../../generated/prisma/client.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { nextChannelContentId } from './channel-content-id.js';
import { calculateBirthdayDdayFromDate, calculateMilestonesFromDate, pickNextUpcomingEvent } from './upstream/channel-anniversary.utils.js';

const stringFields = {
  residence: 255, heightCm: 32, weightKg: 32, nationality: 100,
  symbolColor: 20, agency: 255, nickname: 100, description: 100000,
  fandomName: 100, religion: 100, bio: 65535, homeDescription: 100000,
} as const;
const genderValues = new Set<Gender>(['MALE', 'FEMALE', 'NONBINARY', 'OTHER', 'SECRET']);
const mbtiValues = new Set<MBTI>(['ISTJ', 'ISTP', 'ISFJ', 'ISFP', 'INTJ', 'INTP', 'INFJ', 'INFP',
  'ESTP', 'ESTJ', 'ESFP', 'ESFJ', 'ENTP', 'ENTJ', 'ENFP', 'ENFJ']);
const listFields = ['affiliatedGroups', 'education', 'alias', 'broadcastingPlatforms'] as const;

function parse(value: unknown): Prisma.ChannelProfileUncheckedUpdateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
  const raw = value as Record<string, unknown>;
  const allowed = new Set<string>([...Object.keys(stringFields), 'birthday', 'debutDate', 'gender', 'mbti', ...listFields, 'links']);
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new ApiError('INVALID_REQUEST', 400);
  const data: Record<string, unknown> = {};
  for (const [key, max] of Object.entries(stringFields)) {
    const item = raw[key];
    if (item === undefined) continue;
    if (item !== null && (typeof item !== 'string' || item.length > max)) throw new ApiError('INVALID_REQUEST', 400);
    data[key] = key === 'symbolColor' && typeof item === 'string' && item && !item.startsWith('#') ? `#${item}` : item;
  }
  for (const key of ['birthday', 'debutDate'] as const) {
    const item = raw[key];
    if (item === undefined) continue;
    if (item === null) { data[key] = null; continue; }
    if (typeof item !== 'string' || item.length > 40 || !Number.isFinite(Date.parse(item))) throw new ApiError('INVALID_REQUEST', 400);
    data[key] = new Date(item);
  }
  for (const [key, values] of [['gender', genderValues], ['mbti', mbtiValues]] as const) {
    const item = raw[key];
    if (item === undefined) continue;
    if (item !== null && (typeof item !== 'string' || !values.has(item as Gender & MBTI))) throw new ApiError('INVALID_REQUEST', 400);
    data[key] = item;
  }
  for (const key of listFields) {
    const item = raw[key];
    if (item === undefined) continue;
    if (!Array.isArray(item) || item.length > 100 || item.some(part => typeof part !== 'string' || part.length > 255)) throw new ApiError('INVALID_REQUEST', 400);
    data[key] = item;
  }
  if (raw.links !== undefined) {
    const links = raw.links;
    if (!Array.isArray(links) || links.length > 30 || links.some(link => {
      if (!link || typeof link !== 'object' || Array.isArray(link)) return true;
      const item = link as Record<string, unknown>;
      return Object.keys(item).some(key => !['label', 'url', 'icon'].includes(key)) ||
        typeof item.label !== 'string' || item.label.length > 100 ||
        typeof item.url !== 'string' || item.url.length > 2048 ||
        typeof item.icon !== 'string' || item.icon.length > 100 ||
        !URL.canParse(item.url) || !['http:', 'https:'].includes(new URL(item.url).protocol);
    })) throw new ApiError('INVALID_REQUEST', 400);
    data.links = links;
  }
  return data as Prisma.ChannelProfileUncheckedUpdateInput;
}

function response(profile: ChannelProfile | null) {
  if (!profile) return { channelId: 1 };
  const milestones = profile.debutDate ? calculateMilestonesFromDate(profile.debutDate) : null;
  const birthday = profile.birthday ? calculateBirthdayDdayFromDate(profile.birthday) : null;
  const next = pickNextUpcomingEvent(milestones, birthday);
  return {
    channelId: 1,
    birthday: profile.birthday?.toISOString(),
    residence: profile.residence ?? undefined,
    heightCm: profile.heightCm ?? undefined,
    weightKg: profile.weightKg ?? undefined,
    nationality: profile.nationality ?? undefined,
    gender: profile.gender ?? undefined,
    symbolColor: profile.symbolColor ?? undefined,
    agency: profile.agency ?? undefined,
    nickname: profile.nickname ?? undefined,
    description: profile.description ?? undefined,
    affiliatedGroups: profile.affiliatedGroups ?? undefined,
    fandomName: profile.fandomName ?? undefined,
    religion: profile.religion ?? undefined,
    education: profile.education ?? undefined,
    mbti: profile.mbti ?? undefined,
    alias: profile.alias ?? undefined,
    debutDate: profile.debutDate?.toISOString(),
    broadcastingPlatforms: profile.broadcastingPlatforms ?? undefined,
    bio: profile.bio ?? undefined,
    homeDescription: profile.homeDescription ?? undefined,
    links: profile.links ?? undefined,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
    ...(milestones || birthday ? { anniversaries: {
      milestones, birthday,
      nextUpcomingEvent: next ? { type: next.type, label: next.label, daysUntil: next.daysUntil } : null,
    } } : {}),
  };
}

@Injectable()
export class MelomingProfileService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  public() {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      return response(await tx.prisma.channelProfile.findUnique({ where: { channelId: roomId } }));
    });
  }

  save(credentials: CommandCredentials, value: unknown) {
    const data = parse(value);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      const profile = await tx.prisma.channelProfile.upsert({
        where: { channelId: roomId },
        create: { ...data as Prisma.ChannelProfileUncheckedCreateInput, id: await nextChannelContentId(tx.prisma), channelId: roomId },
        update: data,
      });
      return response(profile);
    });
  }
}
