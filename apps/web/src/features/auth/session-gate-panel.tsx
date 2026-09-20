'use client';

import Link from 'next/link';
import { CircleAlert, LockKeyhole, RefreshCw } from 'lucide-react';

import { Button } from '@/shared/ui/button';
import type { SessionGateState } from '@/core/session/session-gate';
import { channelHref } from '@/features/channel/model/channel-features';
import { useSessionGate } from './use-session-gate';

const STEPS = ['로기챗 로그인', 'SOOP 계정 연결', '채팅방 입장'] as const;

/**
 * Renders the state of a private screen's gate. Every state has a text explanation and, where an
 * action exists, an explicit button. Nothing here starts a login, a join or a redirect on its own.
 */
export function SessionGatePanel({ screen }: { screen: 'chat' | 'settings' }) {
  const state = useSessionGate();
  const screenLabel = screen === 'chat' ? '채팅방' : '내 설정';

  return (
    <section
      aria-labelledby="session-gate-title"
      aria-busy={state.kind === 'checking'}
      data-session-gate={state.kind}
      className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 md:px-8"
    >
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-strong text-ink">
          {state.kind === 'networkError' || state.kind === 'roomUnavailable' ? (
            <CircleAlert className="size-6" aria-hidden="true" />
          ) : (
            <LockKeyhole className="size-6" aria-hidden="true" />
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <h1 id="session-gate-title" className="text-[22px] font-bold text-ink">
            {titleFor(state, screenLabel)}
          </h1>
          <p role="status" className="text-[16px] leading-normal text-body">
            {descriptionFor(state, screenLabel)}
          </p>
        </div>
      </div>

      <ol className="flex flex-col gap-2 rounded-md border border-line px-5 py-4">
        {STEPS.map((step, index) => (
          <li key={step} className="flex items-center gap-3 text-[16px] text-body">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-strong text-[14px] font-semibold text-ink">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-3">
        {actionFor(state)}
        <Button asChild variant="outline">
          <Link href={channelHref('home')}>홈으로</Link>
        </Button>
      </div>
    </section>
  );
}

function titleFor(state: SessionGateState, screenLabel: string): string {
  switch (state.kind) {
    case 'checking':
      return '로그인 상태를 확인하고 있어요';
    case 'unavailable':
      return '로그인이 아직 연결되지 않았어요';
    case 'unauthenticated':
      return `${screenLabel}은 로그인 후 이용할 수 있어요`;
    case 'soopLinkRequired':
      return 'SOOP 계정 연결이 필요해요';
    case 'notJoined':
      return '채팅방에 아직 들어가지 않았어요';
    case 'joined':
      return `${screenLabel}을 여는 중이에요`;
    case 'roomUnavailable':
      return '지금은 채팅방을 열 수 없어요';
    case 'networkError':
      return '연결을 확인할 수 없어요';
  }
}

function descriptionFor(state: SessionGateState, screenLabel: string): string {
  switch (state.kind) {
    case 'checking':
      return '잠시만 기다려 주세요.';
    case 'unavailable':
      return `${screenLabel} 화면은 준비되어 있지만 실제 로그인, SOOP 연결, 입장은 아직 열리지 않았어요. 연결되면 아래 순서로 이용할 수 있어요.`;
    case 'unauthenticated':
      return '로그인하면 이어서 SOOP 계정을 연결하고 채팅방에 들어갈 수 있어요.';
    case 'soopLinkRequired':
      return '로그인은 되어 있지만 SOOP 계정이 연결되지 않았어요. 내 설정에서 연결을 진행해 주세요.';
    case 'notJoined':
      return '입장 버튼을 누르면 이 채팅방에 참여합니다. 알림이나 주소만으로 자동 입장하지 않아요.';
    case 'joined':
      return '잠시만 기다려 주세요.';
    case 'roomUnavailable':
      return '채팅방이 중지되었거나 접근할 수 없는 상태예요. 잠시 후 다시 확인해 주세요.';
    case 'networkError':
      return '네트워크 상태를 확인한 뒤 다시 시도해 주세요. 이전 화면의 내용은 표시하지 않아요.';
  }
}

function actionFor(state: SessionGateState) {
  switch (state.kind) {
    case 'unavailable':
    case 'unauthenticated':
      return (
        <Button asChild>
          <Link href="/login">로그인 화면 보기</Link>
        </Button>
      );
    case 'soopLinkRequired':
      return (
        <Button asChild>
          <Link href={channelHref('settings')}>내 설정으로</Link>
        </Button>
      );
    case 'notJoined':
      return (
        <Button type="button" disabled aria-disabled="true">
          입장 (준비 중)
        </Button>
      );
    case 'networkError':
    case 'roomUnavailable':
      return (
        <Button type="button" disabled aria-disabled="true">
          <RefreshCw className="size-5" aria-hidden="true" />
          다시 확인 (준비 중)
        </Button>
      );
    default:
      return null;
  }
}
