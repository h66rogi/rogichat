'use client';

import { useId } from 'react';
import { LoaderCircle, LogOut } from 'lucide-react';

import { Button } from '@/shared/ui/button';

import type { SettingsSessionModel } from '../types';
import { ActionReason, SettingsSection, effectiveState } from './section-shell';

export function SessionSection({ model, onLogout }: { model: SettingsSessionModel; onLogout?: (() => void | Promise<void>) | undefined }) {
  const state = effectiveState(model.logout, onLogout);
  const reasonId = useId();
  const pending = model.logoutPending === true;

  return (
    <SettingsSection
      id="session"
      title="로그아웃"
      description="이 브라우저에서 로그아웃합니다."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => void onLogout?.()} disabled={!state.enabled || pending} aria-busy={pending} aria-describedby={state.enabled ? undefined : reasonId} data-testid="settings-logout">
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
            {pending ? '로그아웃 처리 중' : '로그아웃'}
          </Button>
          <ActionReason state={state} id={reasonId} />
        </>
      }
    >
      {pending && (
        <p className="rounded-sm bg-surface-soft px-4 py-3 text-[14px] text-body" role="status" data-testid="settings-logout-pending">
          로그아웃이 완료됐는지 확인할 수 없어요. 다시 시도해 주세요.
        </p>
      )}
    </SettingsSection>
  );
}
