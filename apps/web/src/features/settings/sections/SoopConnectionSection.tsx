'use client';

import { useId } from 'react';
import { Link2 } from 'lucide-react';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

import type { SettingsSoopModel } from '../types';
import { ActionReason, InfoRow, SettingsSection, effectiveState } from './section-shell';

export function SoopConnectionSection({ model, onLink }: { model: SettingsSoopModel; onLink?: (() => void | Promise<void>) | undefined }) {
  const state = effectiveState(model.link, onLink);
  const reasonId = useId();
  const linked = model.status === 'linked';

  return (
    <SettingsSection
      id="soop"
      title="SOOP 연결"
      description="채팅에 사용할 SOOP 계정을 연결합니다."
      footer={
        !linked && (
          <>
            <Button type="button" variant="outline" onClick={() => void onLink?.()} disabled={!state.enabled} aria-describedby={state.enabled ? undefined : reasonId} data-testid="settings-soop-link">
              <Link2 className="size-4" aria-hidden="true" />
              SOOP 계정 연결
            </Button>
            <ActionReason state={state} id={reasonId} />
          </>
        )
      }
    >
      <dl className="flex flex-col gap-2">
        <InfoRow
          label="상태"
          value={
            <Badge variant={linked ? 'brand' : model.status === 'unlinked' ? 'outline' : 'secondary'} data-testid="settings-soop-status">
              {linked ? '연결됨' : model.status === 'unlinked' ? '연결 안 됨' : '확인 중'}
            </Badge>
          }
        />
        {linked && model.linkedName && <InfoRow label="연결된 계정" value={model.linkedName} />}
      </dl>
      {linked && <p className="text-[13px] text-muted">연결을 해제하려면 계정 탈퇴 절차를 이용해 주세요. 연결 해제만 따로 제공하지는 않습니다.</p>}
    </SettingsSection>
  );
}
