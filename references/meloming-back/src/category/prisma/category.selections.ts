import { Prisma } from '@prisma/client';

export const categoryListQuery = {
  include: {
    _count: {
      select: { songCategories: true },
    },
    channel: {
      select: {
        id: true,
        name: true,
        user: { select: { id: true, nickname: true } },
      },
    },
  },
} as const;

export type CategoryWithCounts = Prisma.CategoryGetPayload<{
  include: typeof categoryListQuery.include;
}>;
