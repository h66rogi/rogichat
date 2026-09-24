import { getChannelIdentifierServer } from '@/meloming/domains/channel/apis/channels-server';
import { getChannelFavoritesCountServer } from '@/meloming/domains/channel/apis/favorites-server';
import { generateChannelOGImage } from '@/meloming/shared/lib/opengraph-image-utils';
import { CHANNEL_IDENTIFIER } from './feature-page';

export async function featureOgImage(tab: 'schedule' | 'musicbook' | 'setlist') {
  const channel = await getChannelIdentifierServer(CHANNEL_IDENTIFIER);
  const favoritesData = channel ? await getChannelFavoritesCountServer(channel.id) : null;
  return generateChannelOGImage(channel, favoritesData?.totalFavorites ?? 0, tab);
}
