import { notFound } from 'next/navigation';
import { ChannelSetlistDetailContent } from '@/meloming/domains/channel/components/channel-setlist-detail-content';
import { CHANNEL_IDENTIFIER, FeaturePage, featureMetadata } from '@/features/channel/content/feature-page';

type Props = { params: Promise<{ sessionId: string }> };

export const generateMetadata = () => featureMetadata('셋리스트 상세', '방송에서 부른 곡 목록을 확인할 수 있습니다.');

export default async function SetlistDetailPage({ params }: Props) {
  const sessionId = Number((await params).sessionId);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) notFound();
  return <FeaturePage title="셋리스트" description="방송에서 부른 곡을 세션별로 확인" relatedLink={{ href: '/setlist', label: '목록으로' }}>
    <ChannelSetlistDetailContent user={CHANNEL_IDENTIFIER} sessionId={sessionId} />
  </FeaturePage>;
}
