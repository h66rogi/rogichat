import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const GLOBAL_SONG_POPULAR_SECTION_KEYS = [
  'ranking',
  'live-now',
  'most-requested',
  'newcomers',
  'most-liked',
  'most-hot-clips',
  'most-donated',
] as const;

export type GlobalSongPopularSectionKey =
  (typeof GLOBAL_SONG_POPULAR_SECTION_KEYS)[number];

export class GlobalSongPopularSectionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be >= 1' })
  @Max(100, { message: 'limit must be <= 100' })
  limit?: number = 100;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be >= 0' })
  @Max(400, { message: 'offset must be <= 400' })
  offset?: number = 0;
}

export class GlobalSongPopularArtistDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;
}

export class GlobalSongPopularChannelDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  profileImage!: string | null;
}

export class GlobalSongPopularItemDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: GlobalSongPopularArtistDto })
  artist!: GlobalSongPopularArtistDto;

  /**
   * 우선순위 0번 (= albumArtUrls[0])과 같은 값. 단일 url 만 쓰는 클라이언트
   * 호환성을 위해 유지. fallback 체이닝이 필요한 클라이언트는 albumArtUrls 사용.
   */
  @ApiProperty({ nullable: true, type: String })
  albumArt!: string | null;

  /**
   * Album art 후보 URL 우선순위 배열 (중복 제거). 0번이 가장 우선.
   * 우선순위: Musixmatch → most-used Song.albumArt → GlobalSong.albumArt.
   * 클라이언트는 첫 url 로딩이 실패하면 다음 url 로 자동 fallback 한 뒤,
   * 모두 실패하면 placeholder 아이콘을 노출한다.
   */
  @ApiProperty({ type: [String] })
  albumArtUrls!: string[];

  @ApiProperty()
  channelCount!: number;

  /** Up to 5 PUBLIC channels that registered this song, sorted by follower count Desc. */
  @ApiProperty({ type: [GlobalSongPopularChannelDto] })
  topChannels!: GlobalSongPopularChannelDto[];
}

export class GlobalSongPopularNewcomerDto extends GlobalSongPopularItemDto {
  /** ISO-8601 timestamp of GlobalSong row creation. */
  @ApiProperty()
  createdAt!: string;
}

export class GlobalSongPopularTopArtistDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;

  /** Number of GlobalSong rows linked to this artist with channelCount > 0. */
  @ApiProperty()
  songCount!: number;

  /** Sum of channelCount across this artist's GlobalSong rows. */
  @ApiProperty()
  totalChannelCount!: number;

  /** This artist's most-registered songs. */
  @ApiProperty({ type: [GlobalSongPopularItemDto] })
  topSongs!: GlobalSongPopularItemDto[];
}

/**
 * Wrapper subtypes — each facet annotates the base item with the metric it
 * sorts on, so the frontend card can surface what the section name promises.
 */
export class GlobalSongLiveNowItemDto extends GlobalSongPopularItemDto {
  /** Number of currently ACTIVE LiveSessions playing this GlobalSong right now. */
  @ApiProperty()
  liveCount!: number;
}

export class GlobalSongMostRequestedItemDto extends GlobalSongPopularItemDto {
  /** SongRequest rows in the last 7 days targeting any Song under this GlobalSong. */
  @ApiProperty()
  recentRequestCount!: number;
}

export class GlobalSongMostLikedItemDto extends GlobalSongPopularItemDto {
  /** UserSongLike rows summed across every Song under this GlobalSong. */
  @ApiProperty()
  likeCount!: number;
}

export class GlobalSongMostClippedItemDto extends GlobalSongPopularItemDto {
  /** DISTINCT visible Clip count attached to this GlobalSong on PUBLIC channels. */
  @ApiProperty()
  clipCount!: number;

  /** Sum of ClipStat.viewCount across those clips. */
  @ApiProperty()
  clipViewSum!: number;
}

export class GlobalSongMostDonatedItemDto extends GlobalSongPopularItemDto {
  /** SUM(donation_amount_krw) across SongRequest rows in the last 7 days. */
  @ApiProperty()
  recentDonationKrw!: number;
}

export class GlobalSongPopularResponseDto {
  /** GlobalSong rows ordered by channelCount DESC. */
  @ApiProperty({ type: [GlobalSongPopularItemDto] })
  ranking!: GlobalSongPopularItemDto[];

  /** Recently created GlobalSong rows that already have ≥1 channel. */
  @ApiProperty({ type: [GlobalSongPopularNewcomerDto] })
  newcomers!: GlobalSongPopularNewcomerDto[];

  /** GlobalArtist rows ordered by SUM(channelCount) DESC, with their top songs. */
  @ApiProperty({ type: [GlobalSongPopularTopArtistDto] })
  topArtists!: GlobalSongPopularTopArtistDto[];

  /** Songs currently being played in any ACTIVE LiveSession (real-time hot signal). */
  @ApiProperty({ type: [GlobalSongLiveNowItemDto] })
  liveNow!: GlobalSongLiveNowItemDto[];

  /** Songs requested most often in the last 7 days. */
  @ApiProperty({ type: [GlobalSongMostRequestedItemDto] })
  mostRequestedThisWeek!: GlobalSongMostRequestedItemDto[];

  /** Songs with the highest UserSongLike total. */
  @ApiProperty({ type: [GlobalSongMostLikedItemDto] })
  mostLiked!: GlobalSongMostLikedItemDto[];

  /** Songs whose clips accumulated the most views overall. */
  @ApiProperty({ type: [GlobalSongMostClippedItemDto] })
  mostHotClips!: GlobalSongMostClippedItemDto[];

  /** Songs that received the largest donation total via donation-message song-request in the last 7 days. */
  @ApiProperty({ type: [GlobalSongMostDonatedItemDto] })
  mostDonated!: GlobalSongMostDonatedItemDto[];

  /** ISO-8601 timestamp of when this snapshot was assembled. */
  @ApiProperty()
  generatedAt!: string;
}

export class GlobalSongPopularSectionResponseDto {
  @ApiProperty({ enum: GLOBAL_SONG_POPULAR_SECTION_KEYS })
  section!: GlobalSongPopularSectionKey;

  @ApiProperty({
    type: [GlobalSongPopularItemDto],
    description:
      'Section rows. Metric-specific sections include their metric field on each item.',
  })
  items!: Array<
    | GlobalSongPopularItemDto
    | GlobalSongPopularNewcomerDto
    | GlobalSongLiveNowItemDto
    | GlobalSongMostRequestedItemDto
    | GlobalSongMostLikedItemDto
    | GlobalSongMostClippedItemDto
    | GlobalSongMostDonatedItemDto
  >;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  maxRank!: number;

  @ApiProperty()
  hasNextPage!: boolean;

  @ApiProperty()
  generatedAt!: string;
}
