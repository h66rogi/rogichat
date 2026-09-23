import type { Metadata } from 'next';
import { ChannelWardrobeContent } from '@/features/channel/channel-wardrobe-content';

export const metadata: Metadata = { title: '후로기 옷장', description: '후로기의 의상과 헤어 컬렉션' };
export default function WardrobePage() { return <ChannelWardrobeContent />; }
