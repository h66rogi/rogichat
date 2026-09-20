'use client';

import { useId } from 'react';
import { Bell, BellOff } from 'lucide-react';

import { Label } from '@/shared/ui/label';

import type { SettingsNotificationsModel } from '../types';
import { ActionReason, InfoRow, SettingsSection, effectiveState } from './section-shell';

export function NotificationSection({
  model,
  onToggle,
}: {
  model: SettingsNotificationsModel;
  onToggle?: ((next: boolean) => void | Promise<void>) | undefined;
}) {
  const state = effectiveState(model.toggle, onToggle);
  const reasonId = useId();
  const switchId = useId();

  if (model.enabled === null) return (
    <SettingsSection id="notifications" title="알림" description="현재 웹에서는 새 메시지 알림을 제공하지 않습니다.">
      <p className="text-[14px] text-body">새 메시지는 채팅 화면에서 확인해 주세요.</p>
    </SettingsSection>
  );

  return (
    <SettingsSection id="notifications" title="알림" description="새 메시지 알림을 이 브라우저에서 받을지 정합니다. 알림 권한은 여기서 켤 때만 요청합니다.">
      <dl className="flex flex-col gap-2">
        <InfoRow label="이 브라우저" value={supportLabel(model.support)} />
        <InfoRow label="알림 권한" value={permissionLabel(model.permission)} />
      </dl>

      <div className="flex items-start justify-between gap-4 rounded-sm bg-surface-soft px-4 py-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={switchId} className="text-[14px]">
            새 메시지 알림
          </Label>
          <p className="text-[13px] leading-[1.43] text-muted">
            {model.enabled ? '이 브라우저로 새 메시지 알림을 보냅니다. 알림에는 메시지 내용이 포함되지 않습니다.' : '꺼져 있습니다. 켜면 이 브라우저에 새 메시지가 있음을 알립니다.'}
          </p>
          <ActionReason state={state} id={reasonId} />
        </div>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={model.enabled}
          aria-describedby={state.enabled ? undefined : reasonId}
          disabled={!state.enabled}
          onClick={() => void onToggle?.(!model.enabled)}
          className="relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border border-control-border bg-canvas transition-colors aria-checked:border-ink aria-checked:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="settings-notifications-toggle"
        >
          <span className="sr-only">{model.enabled ? '알림 켜짐' : '알림 꺼짐'}</span>
          <span aria-hidden="true" className={`inline-flex size-6 items-center justify-center rounded-full transition-transform ${model.enabled ? 'translate-x-7 bg-canvas text-ink' : 'translate-x-1 bg-control-border text-canvas'}`}>
            {model.enabled ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
          </span>
        </button>
      </div>
    </SettingsSection>
  );
}

function supportLabel(support: SettingsNotificationsModel['support']): string {
  switch (support) {
    case 'supported':
      return '알림 지원';
    case 'unsupported':
      return '알림 미지원';
    case 'install-required':
      return '홈 화면에 추가한 뒤 사용 가능';
    case 'unknown':
      return '확인 중';
  }
}

function permissionLabel(permission: SettingsNotificationsModel['permission']): string {
  switch (permission) {
    case 'granted':
      return '허용됨';
    case 'denied':
      return '차단됨 · 브라우저 설정에서 변경';
    case 'not-asked':
      return '아직 요청하지 않음';
    case 'unknown':
      return '확인 중';
  }
}
