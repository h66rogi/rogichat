'use client';

import Link from 'next/link';
import { Button } from '@/shared/ui/button';

/** Do not expose server errors, request URLs or private response bodies. */
export default function ChannelError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="mx-auto flex max-w-lg flex-col gap-4 px-6 py-12">
      <h1 className="text-xl font-bold">채널을 불러오지 못했어요</h1>
      <p>잠시 후 다시 시도해 주세요. 계속 문제가 생기면 홈으로 돌아가 다른 메뉴를 이용할 수 있어요.</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>다시 시도</Button>
        <Button asChild variant="outline"><Link href="/">후로기 홈으로</Link></Button>
      </div>
    </section>
  );
}
