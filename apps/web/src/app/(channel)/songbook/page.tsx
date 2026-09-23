import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChannelSongbookContent } from '@/features/channel/songbook/channel-songbook-content';

export const metadata: Metadata = { title: '후로기 노래책', description: '후로기의 노래책' };
export default function SongbookPage() { return <Suspense fallback={<p className="px-4 py-8">노래책을 불러오는 중입니다.</p>}><ChannelSongbookContent /></Suspense>; }
