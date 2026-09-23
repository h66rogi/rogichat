import { getChannelIdentifierServer } from "@/meloming/domains/channel/apis/channels-server";
import { getChannelFavoritesCountServer } from "@/meloming/domains/channel/apis/favorites-server";
import {
  generateChannelOGImage,
  OG_IMAGE_SIZE,
  OG_IMAGE_CONTENT_TYPE,
} from "@/meloming/shared/lib/opengraph-image-utils";

export const size = OG_IMAGE_SIZE;
export const contentType = OG_IMAGE_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const { user } = await params;
  const channel = await getChannelIdentifierServer(user);

  const favoritesData = channel
    ? await getChannelFavoritesCountServer(channel.id)
    : null;
  const favoritesCount = favoritesData?.totalFavorites ?? 0;

  return generateChannelOGImage(channel, favoritesCount, "musicbook");
}
