import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChannelWardrobeDetailContent } from '@/features/channel/channel-wardrobe-detail-content';

export const metadata: Metadata = { title: '후로기 옷장' };
export default async function WardrobeDetailPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  if (!/^[1-9]\d*$/.test(itemId)) notFound();
  return <ChannelWardrobeDetailContent itemId={Number(itemId)} />;
}
