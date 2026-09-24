import { ChannelMusicbookContent } from '@/meloming/domains/channel/components/channel-musicbook-content';
import { CHANNEL_IDENTIFIER, FeaturePage, featureMetadata } from '@/features/channel/content/feature-page';

export const generateMetadata = () => featureMetadata('노래책', '노래 목록과 신청곡을 확인할 수 있습니다.');

export default function MusicbookPage() {
  return <FeaturePage title="노래책" description="후로기의 노래 목록과 신청곡" manageSection="songs" relatedLink={{ href: '/setlist', label: '셋리스트' }}>
    <ChannelMusicbookContent user={CHANNEL_IDENTIFIER} />
  </FeaturePage>;
}
