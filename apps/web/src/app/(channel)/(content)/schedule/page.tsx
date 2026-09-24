import { ChannelScheduleContent } from '@/meloming/domains/channel/components/channel-schedule-content';
import { CHANNEL_IDENTIFIER, FeaturePage, featureMetadata } from '@/features/channel/content/feature-page';

export const generateMetadata = () => featureMetadata('일정', '방송 일정과 기념일을 확인할 수 있습니다.');

export default function SchedulePage() {
  return <FeaturePage title="일정" description="후로기의 방송 일정과 기념일" manageSection="schedule-settings">
    <ChannelScheduleContent user={CHANNEL_IDENTIFIER} />
  </FeaturePage>;
}
