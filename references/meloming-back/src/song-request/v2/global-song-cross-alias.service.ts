import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CrossAliasMatchInput {
  channelId: number;
  /** 정규화된 검색 query (title 후보) */
  normTitle: string;
  /** 정규화된 artist 후보 (선택) */
  normArtist?: string;
}

export interface CrossAliasMatch {
  songId: number;
  globalSongId: number;
  /** 매치 사유: alias 일치 / global title 일치 / cross-streamer 빈도 */
  via: 'global_song_alias' | 'global_song_title' | 'global_artist_alias';
  score: number;
}

/**
 * 채널 노래책에 등록된 곡 중, 연결된 GlobalSong의 alias/다른 표기와 매치되는
 * Song을 찾는다. v1 SongMatcherService의 matchByAlias가 alias만 보는 데 비해,
 * 여기서는 GlobalSong.title/normTitle 본문, GlobalArtistAlias까지 함께 본다.
 *
 * 다른 스트리머 노래책에서 어떻게 alias가 쌓였는지를 활용하기 위해, alias 후보는
 * 글로벌 풀에서 찾되 매칭 대상은 항상 "현재 채널에 등록된 song"으로 제한한다
 * (사용자가 신청한 채널 노래책에 그 곡이 없다면 매칭 의미가 없으므로).
 */
@Injectable()
export class GlobalSongCrossAliasService {
  private readonly logger = new Logger(GlobalSongCrossAliasService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findMatch(
    input: CrossAliasMatchInput,
  ): Promise<CrossAliasMatch | null> {
    const { channelId, normTitle, normArtist } = input;
    if (!normTitle) return null;

    // 1) GlobalSongAlias.normAliasTitle == normTitle 인 GlobalSong 후보를 모은 뒤,
    //    그 중 현재 채널에 등록된 Song만 채택.
    const aliasMatches = await this.prisma.globalSongAlias.findMany({
      where: { normAliasTitle: normTitle },
      select: {
        globalSongId: true,
        globalSong: {
          select: {
            id: true,
            normTitle: true,
            globalArtistId: true,
            globalArtist: {
              select: { id: true, aliases: { select: { normAlias: true } } },
            },
          },
        },
      },
      take: 50,
    });

    if (aliasMatches.length > 0) {
      const candidate = await this.pickChannelSong(
        channelId,
        aliasMatches.map((m) => m.globalSongId),
        normArtist,
        aliasMatches.map((m) => ({
          globalSongId: m.globalSongId,
          artistAliases:
            m.globalSong?.globalArtist?.aliases.map((a) => a.normAlias) ?? [],
        })),
      );
      if (candidate) {
        return {
          songId: candidate.songId,
          globalSongId: candidate.globalSongId,
          via: 'global_song_alias',
          score: 0.92,
        };
      }
    }

    // 2) GlobalSong.normTitle == normTitle 인 후보 (alias가 안 잡혔지만 본문 일치)
    const titleMatches = await this.prisma.globalSong.findMany({
      where: { normTitle },
      select: {
        id: true,
        globalArtistId: true,
        globalArtist: {
          select: { id: true, aliases: { select: { normAlias: true } } },
        },
      },
      take: 50,
    });

    if (titleMatches.length > 0) {
      const candidate = await this.pickChannelSong(
        channelId,
        titleMatches.map((g) => g.id),
        normArtist,
        titleMatches.map((g) => ({
          globalSongId: g.id,
          artistAliases: g.globalArtist?.aliases.map((a) => a.normAlias) ?? [],
        })),
      );
      if (candidate) {
        return {
          songId: candidate.songId,
          globalSongId: candidate.globalSongId,
          via: 'global_song_title',
          score: 0.88,
        };
      }
    }

    return null;
  }

  /**
   * 후보 globalSongId 들 중 현재 채널 노래책에 있는 것만 골라낸다.
   * normArtist가 주어지면 GlobalArtistAlias 매칭으로 1곡으로 좁힌다 (없으면 첫 매치).
   */
  private async pickChannelSong(
    channelId: number,
    globalSongIds: number[],
    normArtist: string | undefined,
    artistAliasMap: Array<{ globalSongId: number; artistAliases: string[] }>,
  ): Promise<{ songId: number; globalSongId: number } | null> {
    const songs = await this.prisma.song.findMany({
      where: { channelId, globalSongId: { in: globalSongIds } },
      select: { id: true, globalSongId: true },
    });
    if (songs.length === 0) return null;
    if (songs.length === 1 || !normArtist) {
      return {
        songId: songs[0].id,
        globalSongId: songs[0].globalSongId!,
      };
    }
    // normArtist가 있고 후보가 여럿이면 artist alias로 좁히기
    const aliasIndex = new Map(
      artistAliasMap.map((m) => [m.globalSongId, m.artistAliases]),
    );
    for (const s of songs) {
      const aliases = aliasIndex.get(s.globalSongId!) ?? [];
      if (aliases.includes(normArtist)) {
        return { songId: s.id, globalSongId: s.globalSongId! };
      }
    }
    // 매치 안 되면 첫 항목 (호출자가 confidence 낮춰 후처리)
    return { songId: songs[0].id, globalSongId: songs[0].globalSongId! };
  }
}
