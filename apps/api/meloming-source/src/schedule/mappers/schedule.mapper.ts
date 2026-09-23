import { ScheduleResponseDto } from '../dto/schedule.response.dto';

type Author = { id: number; nickname: string; profileImageUrl: string | null };

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

export function toScheduleResponse(
  row: any,
  fallbackAuthor?: Author,
): ScheduleResponseDto {
  const author: Author = row.author ??
    fallbackAuthor ?? {
      id: row.authorUserId,
      nickname: '',
      profileImageUrl: null,
    };
  return {
    id: row.id,
    channelId: row.channelId,
    channelWebPath: row.channel?.webPath ?? null,
    channel: row.channel
      ? {
          id: row.channel.id ?? row.channelId,
          name: row.channel.name ?? '',
          profileImageUrl: row.channel.profileImageUrl ?? null,
          webPath: row.channel.webPath ?? null,
          isOwnerProSubscriber: row.channel.user
            ? isProSubscriptionActive({
                isProSubscriber: row.channel.user.isProSubscriber ?? null,
                proSubscriptionEndAt:
                  row.channel.user.proSubscriptionEndAt ?? null,
              })
            : false,
          isOwnerAmbassador: !!row.channel.user?.isAmbassador,
        }
      : undefined,
    author: {
      id: author.id,
      nickname: author.nickname,
      profileImageUrl: author.profileImageUrl ?? null,
    },
    title: row.title,
    content: row.content ?? null,
    startAt:
      row.startAt instanceof Date
        ? row.startAt.toISOString()
        : String(row.startAt),
    endAt:
      row.endAt instanceof Date
        ? row.endAt.toISOString()
        : row.endAt
          ? String(row.endAt)
          : null,
    allDay: !!row.allDay,
    isCanceled: !!row.isCanceled,
    status: row.status,
    visibility: row.visibility,
    location: row.location ?? null,
    externalUrl: row.externalUrl ?? null,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : String(row.updatedAt),
  };
}
