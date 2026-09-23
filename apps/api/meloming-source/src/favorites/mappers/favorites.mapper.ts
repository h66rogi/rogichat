import {
  ChannelFavoriteDto,
  SongFavoriteDto,
} from '../dto/favorites.response.dto';

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

export function toChannelFavoriteDto(favorite: {
  id: number;
  channelId: number;
  createdAt: Date;
  channel: {
    name: string;
    channelDescription: string | null;
    webPath: string;
    themeColor: string;
    profileImageUrl: string | null;
    user: {
      nickname: string;
      isProSubscriber: boolean | null;
      proSubscriptionEndAt: Date | null;
      isAmbassador: boolean | null;
    };
    _count: { songs: number; artists: number; userFavorites: number };
  };
}): ChannelFavoriteDto {
  return {
    id: favorite.id,
    channelId: favorite.channelId,
    channelName: favorite.channel.name,
    profileImageUrl: favorite.channel.profileImageUrl ?? undefined,
    webPath: favorite.channel.webPath,
    themeColor: favorite.channel.themeColor,
    ownerNickname: favorite.channel.user.nickname,
    channelDescription: favorite.channel.channelDescription ?? undefined,
    createdAt: favorite.createdAt,
    songCount: favorite.channel._count.songs,
    artistCount: favorite.channel._count.artists,
    favoritesCount: favorite.channel._count.userFavorites,
    isOwnerProSubscriber: isProSubscriptionActive(favorite.channel.user),
    isOwnerAmbassador: !!favorite.channel.user.isAmbassador,
  };
}

export function toSongFavoriteDto(favorite: {
  id: number;
  songId: number;
  createdAt: Date;
  song: {
    title: string;
    albumArt: string | null;
    artist: { name: string };
    channel: { name: string; webPath: string; profileImageUrl: string | null };
  };
}): SongFavoriteDto {
  return {
    id: favorite.id,
    songId: favorite.songId,
    songTitle: favorite.song.title,
    artistName: favorite.song.artist.name,
    albumArt: favorite.song.albumArt ?? undefined,
    channelName: favorite.song.channel.name,
    webPath: favorite.song.channel.webPath,
    channelProfileImageUrl: favorite.song.channel.profileImageUrl ?? undefined,
    createdAt: favorite.createdAt,
  };
}
