import type { Metadata } from 'next';
import { MessageSearch } from '@/features/chat/MessageSearch';

export const metadata: Metadata = { title: '대화 내용 검색', robots: { index: false, follow: false } };
export default function SearchPage() { return <MessageSearch />; }
