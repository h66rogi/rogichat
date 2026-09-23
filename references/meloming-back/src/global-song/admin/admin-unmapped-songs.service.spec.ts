import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalSongRedisService } from '../global-song-redis.service';
import { CacheKeyTrackingService } from '../../redis/cache-key-tracking.service';
import { AdminUnmappedSongsService } from './admin-unmapped-songs.service';

/**
 * link() 충돌 처리 — songs 의 (channelId, globalSongId) unique 제약
 * (unique_songs_channel_globalsong) 위반 시 500 이 아니라 409 로 반환.
 *
 * 채널 내 중복곡(같은 글로벌곡에 이미 매핑된 다른 song)을 다시 link 하려는
 * 케이스. 사전 체크 경로와 race 시 P2002 catch 경로 둘 다 ConflictException.
 * 스트리머가 등록한 곡 자체를 병합/수정하지 않고, 충돌을 명확히 알리는 방향.
 */
describe('AdminUnmappedSongsService.link — duplicate globalSong in channel', () => {
  let prisma: {
    song: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    globalSong: { findUnique: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let redis: {
    setChannelSongMapping: jest.Mock;
    addToChannelSongSet: jest.Mock;
  };
  let cacheTracker: { clearChannelSafe: jest.Mock };
  let svc: AdminUnmappedSongsService;

  beforeEach(() => {
    prisma = {
      song: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      globalSong: { findUnique: jest.fn(), update: jest.fn() },
      $queryRaw: jest.fn(),
    };
    redis = {
      setChannelSongMapping: jest.fn().mockResolvedValue(undefined),
      addToChannelSongSet: jest.fn().mockResolvedValue(undefined),
    };
    cacheTracker = {
      clearChannelSafe: jest.fn().mockResolvedValue(undefined),
    };

    svc = new AdminUnmappedSongsService(
      prisma as unknown as PrismaService,
      redis as unknown as GlobalSongRedisService,
      cacheTracker as unknown as CacheKeyTrackingService,
    );
  });

  it('throws 409 (not 500) when the channel already has a song linked to that globalSong — pre-check', async () => {
    // song 250004: unmapped, channel 2779 (실제 prod 사고 재현)
    prisma.song.findUnique.mockResolvedValue({
      id: 250004,
      channelId: 2779,
      globalSongId: null,
    });
    prisma.globalSong.findUnique.mockResolvedValue({ id: 952 });
    // 같은 채널에 이미 globalSong 952 로 매핑된 song 249720 이 존재
    prisma.song.findFirst.mockResolvedValue({ id: 249720 });

    await expect(svc.link(250004, 952)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // 사전 체크에서 막혀 실제 update 는 시도되지 않아야 한다
    expect(prisma.song.updateMany).not.toHaveBeenCalled();
  });

  it('throws 409 when updateMany races into the unique constraint (P2002)', async () => {
    prisma.song.findUnique.mockResolvedValue({
      id: 250004,
      channelId: 2779,
      globalSongId: null,
    });
    prisma.globalSong.findUnique.mockResolvedValue({ id: 952 });
    // 사전 체크 통과 (그 사이 동시 writer 가 매핑) → updateMany 가 P2002
    prisma.song.findFirst.mockResolvedValue(null);
    prisma.song.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.12.0',
      }),
    );

    await expect(svc.link(250004, 952)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('links normally when no duplicate exists in the channel', async () => {
    prisma.song.findUnique.mockResolvedValue({
      id: 250010,
      channelId: 2779,
      globalSongId: null,
    });
    prisma.globalSong.findUnique.mockResolvedValue({ id: 953 });
    prisma.song.findFirst.mockResolvedValue(null);
    prisma.song.updateMany.mockResolvedValue({ count: 1 });
    prisma.$queryRaw.mockResolvedValue([{ c: BigInt(5) }]);
    prisma.globalSong.update.mockResolvedValue({ id: 953, channelCount: 5 });

    const result = await svc.link(250010, 953);

    expect(result).toEqual({
      songId: 250010,
      globalSongId: 953,
      alreadyLinked: false,
      winnerChannelCountAfter: 5,
    });
    expect(prisma.globalSong.update).toHaveBeenCalledWith({
      where: { id: 953 },
      data: { channelCount: 5 },
    });
  });
});
