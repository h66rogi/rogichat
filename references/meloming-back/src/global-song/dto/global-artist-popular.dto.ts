import { ApiProperty } from '@nestjs/swagger';
import { GlobalSongPopularItemDto } from './global-song-popular.dto';

/**
 * Aggregated artist row for /musicbook/artist sections.
 *
 * Mirrors GlobalSongPopularTopArtistDto but augments it with the additional
 * facets the dedicated artist page surfaces (clipCount, plus newcomer-only
 * firstSongAt). The page renders three sections backed by the same item
 * shape so the frontend card stays consistent across sections.
 */
export class GlobalArtistPopularItemDto {
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

  /**
   * DISTINCT visible Clip count across this artist's GlobalSong rows
   * (PUBLIC channel ClipChannel rows). 0 when none.
   */
  @ApiProperty()
  clipCount!: number;

  /** This artist's most-registered songs (channelCount Desc, up to 3). */
  @ApiProperty({ type: [GlobalSongPopularItemDto] })
  topSongs!: GlobalSongPopularItemDto[];
}

export class GlobalArtistPopularNewcomerDto extends GlobalArtistPopularItemDto {
  /**
   * ISO-8601 timestamp of this artist's earliest registered GlobalSong.
   * "Earliest" because the artist's first surfacing on Meloming is what
   * makes the row a newcomer; later additions don't reset that signal.
   */
  @ApiProperty()
  firstSongAt!: string;
}

/** Facet wrappers — same body shape, ordered + annotated by the metric. */
export class GlobalArtistLiveNowItemDto extends GlobalArtistPopularItemDto {
  /** Number of currently ACTIVE LiveSessions playing one of this artist's songs right now. */
  @ApiProperty()
  liveCount!: number;
}

export class GlobalArtistMostRequestedItemDto extends GlobalArtistPopularItemDto {
  /** SongRequest rows in the last 7 days targeting one of this artist's songs. */
  @ApiProperty()
  recentRequestCount!: number;
}

export class GlobalArtistMostLikedItemDto extends GlobalArtistPopularItemDto {
  /** UserSongLike rows summed across every Song attached to one of this artist's GlobalSongs. */
  @ApiProperty()
  likeCount!: number;
}

export class GlobalArtistMostDonatedItemDto extends GlobalArtistPopularItemDto {
  /** SUM(donation_amount_krw) across SongRequest rows in the last 7 days targeting this artist. */
  @ApiProperty()
  recentDonationKrw!: number;
}

export class GlobalArtistPopularResponseDto {
  /** GlobalArtist rows ordered by SUM(channelCount) DESC. */
  @ApiProperty({ type: [GlobalArtistPopularItemDto] })
  ranking!: GlobalArtistPopularItemDto[];

  /**
   * GlobalArtist rows whose earliest channelCount > 0 GlobalSong was
   * created most recently — i.e. artists newly surfaced on Meloming.
   */
  @ApiProperty({ type: [GlobalArtistPopularNewcomerDto] })
  newcomers!: GlobalArtistPopularNewcomerDto[];

  /** GlobalArtist rows ordered by DISTINCT clip count DESC. */
  @ApiProperty({ type: [GlobalArtistPopularItemDto] })
  mostClipped!: GlobalArtistPopularItemDto[];

  /** Artists with at least one song playing in an ACTIVE LiveSession right now. */
  @ApiProperty({ type: [GlobalArtistLiveNowItemDto] })
  liveNow!: GlobalArtistLiveNowItemDto[];

  /** Artists whose songs were requested the most in the last 7 days. */
  @ApiProperty({ type: [GlobalArtistMostRequestedItemDto] })
  mostRequestedThisWeek!: GlobalArtistMostRequestedItemDto[];

  /** Artists with the highest UserSongLike total across all of their songs. */
  @ApiProperty({ type: [GlobalArtistMostLikedItemDto] })
  mostLiked!: GlobalArtistMostLikedItemDto[];

  /** Artists with the largest donation total via donation-message song-request in the last 7 days. */
  @ApiProperty({ type: [GlobalArtistMostDonatedItemDto] })
  mostDonated!: GlobalArtistMostDonatedItemDto[];

  /** ISO-8601 timestamp of when this snapshot was assembled. */
  @ApiProperty()
  generatedAt!: string;
}
