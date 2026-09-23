import { Prisma } from '@prisma/client';

export const artistListQuery = {
  include: {
    _count: {
      select: { songs: true },
    },
    channel: {
      select: {
        id: true,
        name: true,
        user: {
          select: { id: true, nickname: true },
        },
      },
    },
  },
} as const;

export type ArtistWithCounts = Prisma.ArtistGetPayload<{
  include: typeof artistListQuery.include;
}>;
