import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { channelHref } from '@/features/channel/model/channel-features';
import { LOGIN_REASON_MESSAGES, parseLoginReason } from '@/features/auth/login-reason';

export const metadata: Metadata = {
  title: '로그인',
  robots: { index: false, follow: false },
};

/**
 * Login screen. Only authentication methods the server actually offers are shown as enabled. In FW01
 * no web login contract is connected, so the SOOP button is disabled and labelled as not ready.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reason = parseLoginReason(params.reason);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold text-ink">로그인</h1>
        <p className="text-[16px] text-body">SOOP 계정으로 로그인하고 후로기 채팅방에 참여해요.</p>
      </div>

      {reason ? (
        <p role="alert" className="rounded-sm border border-danger/40 bg-danger/5 px-4 py-3 text-[14px] text-ink">
          {LOGIN_REASON_MESSAGES[reason]}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <Button type="button" size="lg" disabled aria-disabled="true" aria-describedby="login-soop-status">
          SOOP으로 로그인
        </Button>
        <p id="login-soop-status" className="text-[14px] text-muted">
          SOOP 로그인 연결을 준비하고 있어요. 연결되면 이 버튼으로 로그인할 수 있어요.
        </p>
      </div>

      <p className="text-[14px] leading-[1.43] text-muted">
        로그인하면 서비스 약관과 개인정보 처리방침에 동의하게 돼요. 두 문서의 확정본은 로그인 연결 전에 이 화면에 연결돼요.
      </p>

      <Link href={channelHref('home')} className="inline-flex min-h-11 items-center text-[16px] text-ink underline-offset-4 hover:underline">
        홈으로 돌아가기
      </Link>
    </div>
  );
}
