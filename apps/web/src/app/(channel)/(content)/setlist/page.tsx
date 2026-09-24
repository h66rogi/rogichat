import { ChannelSetlistContent } from '@/meloming/domains/channel/components/channel-setlist-content';
import { CHANNEL_IDENTIFIER, FeaturePage, featureMetadata } from '@/features/channel/content/feature-page';

export const generateMetadata = () => featureMetadata('셋리스트', '방송에서 부른 곡을 세션별로 확인할 수 있습니다.');

export default function SetlistPage() {
  return <FeaturePage>
    <ChannelSetlistContent user={CHANNEL_IDENTIFIER} />
  </FeaturePage>;
}
