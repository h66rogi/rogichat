import { ChannelWardrobeContent } from '@/meloming/domains/channel/components/channel-wardrobe-content';
import { CHANNEL_IDENTIFIER, FeaturePage, featureMetadata } from '@/features/channel/content/feature-page';

export const generateMetadata = () => featureMetadata('옷장', '의상과 헤어 컬렉션을 확인할 수 있습니다.');

export default function WardrobePage() {
  return <FeaturePage>
    <ChannelWardrobeContent user={CHANNEL_IDENTIFIER} />
  </FeaturePage>;
}
