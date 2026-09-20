import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { channelHref } from '@/features/channel/model/channel-features';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-start justify-center gap-4 px-6">
      <p className="text-[14px] font-semibold text-muted">404</p>
      <h1 className="text-[28px] font-bold text-ink">페이지를 찾을 수 없어요</h1>
      <p className="text-[16px] text-body">주소가 바뀌었거나 없는 페이지예요. 후로기 채널 홈으로 돌아갈 수 있어요.</p>
      <Button asChild>
        <Link href={channelHref('home')}>홈으로</Link>
      </Button>
    </main>
  );
}
