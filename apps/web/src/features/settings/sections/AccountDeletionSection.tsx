'use client';

import { useId, useState } from 'react';
import { UserX } from 'lucide-react';

import { Button } from '@/shared/ui/button';

import type { SettingsAccountModel } from '../types';
import { ActionReason, SettingsSection, effectiveState } from './section-shell';

export function AccountDeletionSection({ model, onDelete }: { model: SettingsAccountModel; onDelete?: (() => void | Promise<void>) | undefined }) {
  const state = effectiveState(model.deletion, onDelete);
  const reasonId = useId();
  const [confirming, setConfirming] = useState(false);

  return (
    <SettingsSection
      id="account"
      title="계정 탈퇴"
      tone="danger"
      description="계정과 프로필, SOOP 연결을 삭제하는 절차입니다. 채팅방 나가기와 다르며 되돌릴 수 없습니다. SOOP 연결이 끝나지 않은 계정도 탈퇴할 수 있어야 합니다. 세부 동작은 아직 준비 중입니다."
      footer={
        <div className="flex w-full flex-col gap-3">
          {confirming ? (
            <div className="flex flex-col gap-3 rounded-sm border border-danger/40 px-4 py-3" role="group" aria-label="계정 탈퇴 확인">
              <p className="text-[14px] text-body">정말 탈퇴할까요? 탈퇴 후에는 계정 정보를 복구할 수 없습니다. 다른 기기의 로그아웃과 삭제되는 데이터의 범위·시점은 탈퇴 절차가 확정되면 이 화면에서 안내합니다.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="destructive" onClick={() => void onDelete?.()} disabled={!state.enabled} data-testid="settings-account-delete-confirm">
                  탈퇴하기
                </Button>
                <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" className="border-danger text-danger hover:bg-danger/5" onClick={() => setConfirming(true)} disabled={!state.enabled} aria-describedby={state.enabled ? undefined : reasonId} data-testid="settings-account-delete">
              <UserX className="size-4" aria-hidden="true" />
              계정 탈퇴
            </Button>
          )}
          <ActionReason state={state} id={reasonId} />
        </div>
      }
    />
  );
}
