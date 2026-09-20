import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { channelHref } from '@/features/channel/model/channel-features';

export const metadata: Metadata = {
  title: '로그인 완료',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Proposed fixed web login completion route (W08). The server still returns to `/` on success, so this
 * route is a placeholder: it performs no session verification and consumes no return intent yet.
 * Arriving here is not treated as a successful login.
 */
export default function AuthCompletePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold text-ink">로그인 완료 처리를 준비하고 있어요</h1>
        <p className="text-[16px] text-body">
          이 화면은 로그인 결과를 확인하는 자리예요. 아직 세션 확인이 연결되지 않아 로그인 성공으로 표시하지 않아요.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href={channelHref('home')}>홈으로</Link>
      </Button>
    </div>
  );
}
