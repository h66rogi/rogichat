import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getChannelIdentifierServer } from '@/meloming/domains/channel/apis/channels-server';
import { getChannelWardrobeServer } from '@/meloming/domains/channel/apis/wardrobe-server';
import { ChannelWardrobeDetailContent } from '@/meloming/domains/channel/components/channel-wardrobe-detail-content';
import { getWardrobeMetaDescription } from '@/meloming/domains/channel/utils/wardrobe-description';
import { CHANNEL_IDENTIFIER, FeaturePage } from '@/features/channel/content/feature-page';

type Props = { params: Promise<{ itemId: string }> };

async function getItem(itemIdParam: string) {
  const itemId = Number(itemIdParam);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) notFound();
  const [channel, wardrobe] = await Promise.all([
    getChannelIdentifierServer(CHANNEL_IDENTIFIER),
    getChannelWardrobeServer(CHANNEL_IDENTIFIER),
  ]);
  const item = wardrobe?.items.find(candidate => candidate.id === itemId);
  if (!channel || !item) notFound();
  return { channel, item };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { channel, item } = await getItem((await params).itemId);
  const title = `${channel.name} 옷장 - ${item.title}`;
  const description = getWardrobeMetaDescription(item.description, `${channel.name}의 옷장 이미지 컬렉션입니다.`);
  return { title, description, openGraph: { title: `${title} - 로기챗`, description, images: [{ url: item.imageUrl }], siteName: '로기챗', type: 'website' }, twitter: { card: 'summary_large_image', title: `${title} - 로기챗`, description, images: [item.imageUrl] } };
}

export default async function WardrobeDetailPage({ params }: Props) {
  const { item } = await getItem((await params).itemId);
  return <FeaturePage relatedLink={{ href: '/wardrobe', label: '목록으로' }}>
    <ChannelWardrobeDetailContent user={CHANNEL_IDENTIFIER} itemId={item.id} />
  </FeaturePage>;
}
