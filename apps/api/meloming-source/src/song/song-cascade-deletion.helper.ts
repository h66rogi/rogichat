import type { EventEmitter2 } from '@nestjs/event-emitter';
import { PostStatus } from '@prisma/client';
import {
  GLOBAL_SONG_EVENTS,
  SongDeletedEvent,
} from '../global-song/dto/global-song.events';

/**
 * Snapshot helpers for cascade-driven Song deletion.
 *
 * Why this exists: when a Channel or Artist row is deleted via Prisma, MySQL
 * InnoDB's FK cascade removes dependent Song rows directly at the DB layer.
 * Prisma never sees those individual song deletes, so the SongMutationService
 * SONG_DELETED emit path is never executed and the GlobalSong index drifts
 * (channelCount stays high, Redis mappings linger, search keeps surfacing
 * songs from a deleted channel).
 *
 * The fix: callers that trigger such a cascade must snapshot the affected
 * songs BEFORE the parent row is deleted (song_categories cascades with the
 * song so a post-delete query would return nothing) and then emit
 * SONG_DELETED for each row AFTER the parent delete commits.
 *
 * The helpers below produce ready-to-emit `SongDeletedEvent` payloads. They
 * accept either a `PrismaService` or a Prisma transaction client because the
 * snapshot is most race-safe when taken inside the same transaction that
 * deletes the parent row (see `ChannelService.delete`).
 */

export const SONG_CASCADE_SNAPSHOT_SELECT = {
  id: true,
  title: true,
  channelId: true,
  artist: { select: { name: true } },
  songCategories: {
    select: { category: { select: { name: true } } },
  },
} as const;

type SongCascadeRow = {
  id: number;
  title: string;
  channelId: number;
  artist: { name: string } | null;
  songCategories: { category: { name: string } }[];
};

type SongFindManyClient = {
  song: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: typeof SONG_CASCADE_SNAPSHOT_SELECT;
    }) => Promise<SongCascadeRow[]>;
  };
};

function rowToEvent(row: SongCascadeRow): SongDeletedEvent {
  return {
    songId: row.id,
    title: row.title,
    artistName: row.artist?.name ?? '',
    channelId: row.channelId,
    categoryNames: row.songCategories.map((sc) => sc.category.name),
  };
}

export async function snapshotSongsForChannelDeletion(
  prisma: SongFindManyClient,
  channelId: number,
): Promise<SongDeletedEvent[]> {
  const rows = await prisma.song.findMany({
    where: { channelId },
    select: SONG_CASCADE_SNAPSHOT_SELECT,
  });
  return rows.map(rowToEvent);
}

export async function snapshotSongsForArtistDeletion(
  prisma: SongFindManyClient,
  artistId: number,
  channelId: number,
): Promise<SongDeletedEvent[]> {
  const rows = await prisma.song.findMany({
    where: { artistId, channelId },
    select: SONG_CASCADE_SNAPSHOT_SELECT,
  });
  return rows.map(rowToEvent);
}

export async function snapshotSongsByIds(
  prisma: SongFindManyClient,
  songIds: number[],
  channelId: number,
): Promise<SongDeletedEvent[]> {
  if (songIds.length === 0) return [];
  const rows = await prisma.song.findMany({
    where: { id: { in: songIds }, channelId },
    select: SONG_CASCADE_SNAPSHOT_SELECT,
  });
  return rows.map(rowToEvent);
}

export function emitSongDeletedBatch(
  eventEmitter: EventEmitter2,
  events: SongDeletedEvent[],
): void {
  for (const event of events) {
    eventEmitter.emit(GLOBAL_SONG_EVENTS.SONG_DELETED, event);
  }
}

type ClipOrphanClient = {
  clip: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: { id: true };
    }) => Promise<{ id: number }[]>;
    updateMany: (args: {
      where: { id: { in: number[] } };
      data: { status: PostStatus; deletedAt: Date };
    }) => Promise<{ count: number }>;
  };
};

/**
 * Soft-delete clips that become orphans when the given songs disappear.
 * "Orphan" = every ClipChannel of the clip references only the songs being
 * removed. The `channelId` filter scopes the lookup to the channel whose
 * songs are about to be deleted, so a stray songId from another channel
 * cannot accidentally soft-delete that channel's clip.
 *
 * Returns the IDs of clips that were soft-deleted. Caller passes this to
 * the API response for clip cleanup attribution.
 */
export async function softDeleteOrphanClipsByIds(
  prisma: ClipOrphanClient,
  songIds: number[],
  channelId: number,
): Promise<number[]> {
  if (songIds.length === 0) return [];
  const clips = await prisma.clip.findMany({
    where: {
      status: { not: PostStatus.DELETED },
      clipChannels: {
        some: { songId: { in: songIds }, channelId },
        every: { songId: { in: songIds }, channelId },
      },
    },
    select: { id: true },
  });
  const ids = clips.map((c) => c.id);
  if (ids.length > 0) {
    await prisma.clip.updateMany({
      where: { id: { in: ids } },
      data: { status: PostStatus.DELETED, deletedAt: new Date() },
    });
  }
  return ids;
}
