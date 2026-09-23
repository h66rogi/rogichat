import type { Metadata } from 'next';
import { ChannelScheduleContent } from '@/features/channel/schedule/channel-schedule-content';

export const metadata: Metadata = { title: '후로기 일정', description: '후로기의 방송 일정' };
export default function SchedulePage() { return <ChannelScheduleContent />; }
