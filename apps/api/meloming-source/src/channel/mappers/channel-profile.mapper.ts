import type { ChannelProfile } from '@prisma/client';
import {
  ChannelAnniversariesDto,
  ChannelBirthdayDdayDto,
  ChannelMilestonesDto,
  ChannelNextUpcomingEventDto,
  ChannelProfileResponseDto,
  LinkDto,
} from '../dto/channel-profile.dto';
import {
  calculateBirthdayDdayFromDate,
  calculateMilestonesFromDate,
  pickNextUpcomingEvent,
} from '../utils/channel-anniversary.utils';

function buildAnniversaries(
  entity: ChannelProfile,
): ChannelAnniversariesDto | undefined {
  const hasDebutDate = Boolean(entity.debutDate);
  const hasBirthday = Boolean(entity.birthday);

  if (!hasDebutDate && !hasBirthday) return undefined;

  const milestones: ChannelMilestonesDto | null = entity.debutDate
    ? calculateMilestonesFromDate(entity.debutDate)
    : null;

  const birthdayDday: ChannelBirthdayDdayDto | null = entity.birthday
    ? calculateBirthdayDdayFromDate(entity.birthday)
    : null;

  const next =
    milestones || birthdayDday
      ? pickNextUpcomingEvent(
          milestones ?? undefined,
          birthdayDday ?? undefined,
        )
      : null;

  const nextEvent: ChannelNextUpcomingEventDto | null = next
    ? {
        type: next.type,
        label: next.label,
        daysUntil: next.daysUntil,
      }
    : null;

  return {
    milestones,
    birthday: birthdayDday,
    nextUpcomingEvent: nextEvent,
  };
}

export function toResponseDto(
  entity: ChannelProfile,
  channelId: number,
): ChannelProfileResponseDto {
  const anniversaries = buildAnniversaries(entity);

  return {
    channelId,
    birthday: entity.birthday ? entity.birthday.toISOString() : undefined,
    residence: entity.residence ?? undefined,
    heightCm: entity.heightCm != null ? String(entity.heightCm) : undefined,
    weightKg: entity.weightKg != null ? String(entity.weightKg) : undefined,
    nationality: entity.nationality ?? undefined,
    gender: entity.gender ?? undefined,
    symbolColor: entity.symbolColor ?? undefined,
    agency: entity.agency ?? undefined,
    nickname: entity.nickname ?? undefined,
    description: entity.description ?? undefined,
    affiliatedGroups:
      (entity.affiliatedGroups as unknown as string[]) ?? undefined,
    fandomName: entity.fandomName ?? undefined,
    religion: entity.religion ?? undefined,
    education: (entity.education as unknown as string[]) ?? undefined,
    mbti: entity.mbti ?? undefined,
    alias: (entity.alias as unknown as string[]) ?? undefined,
    debutDate: entity.debutDate ? entity.debutDate.toISOString() : undefined,
    broadcastingPlatforms:
      (entity.broadcastingPlatforms as unknown as string[]) ?? undefined,
    bio: entity.bio ?? undefined,
    homeDescription: entity.homeDescription ?? undefined,
    links: (entity.links as unknown as LinkDto[]) ?? undefined,
    createdAt: entity.createdAt ? entity.createdAt.toISOString() : undefined,
    updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : undefined,
    anniversaries,
  };
}
