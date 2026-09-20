import { resolveDefaultChannel } from '@/features/channel/model/channel-descriptor';
import { ChannelHome } from '@/features/channel/home/channel-home';

/** The site root is 후로기's channel home. It never redirects to /chat. */
export default function HomePage() {
  return <ChannelHome channel={resolveDefaultChannel()} />;
}
