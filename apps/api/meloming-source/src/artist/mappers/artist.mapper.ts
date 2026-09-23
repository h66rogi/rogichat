import { ArtistDto, ArtistListItemDto } from '../dto/artist.response.dto';
import type { ArtistWithCounts } from '../prisma/artist.selections';

// Prisma result -> ArtistListItemDto
export function toArtistListItemDto(
  artist: ArtistWithCounts,
): ArtistListItemDto {
  return {
    id: artist.id,
    name: artist.name,
    channelId: artist.channelId,
    createdAt: artist.createdAt,
    songCount: artist._count.songs,
    channel: artist.channel,
  };
}

// Prisma result -> ArtistDto
export function toArtistDto(artist: {
  id: number;
  name: string;
  channelId: number;
  createdAt: Date | null;
}): ArtistDto {
  return {
    id: artist.id,
    name: artist.name,
    channelId: artist.channelId,
    createdAt: artist.createdAt,
  };
}
