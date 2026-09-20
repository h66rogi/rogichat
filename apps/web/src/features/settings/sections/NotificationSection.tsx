'use client';

import { useId } from 'react';
import { Bell, BellOff } from 'lucide-react';

import { Label } from '@/shared/ui/label';

import type { SettingsNotificationsModel } from '../types';
import { ActionReason, InfoRow, SettingsSection, effectiveState } from './section-shell';

/**
 * Notification settings.
 *
 * The control shows what the browser and the server actually report. When this browser can no
 * longer receive — the permission was withdrawn, the subscription was replaced, the server key
 * rotated — the switch is not offered as "off, press to turn on", because pressing it cannot
 * turn anything on. The press releases the registration the server still holds, and it is
 * labelled as exactly that.
 */
export function NotificationSection({
  model,
  onToggle,
  onRetry,
}: {
  model: SettingsNotificationsModel;
  onToggle?: ((next: boolean) => void | Promise<void>) | undefined;
  onRetry?: (() => void) | undefined;
}) {
  const state = effectiveState(model.toggle, onToggle);
  const reasonId = useId();
  const switchId = useId();
  const noticeId = useId();
  const busy = model.busy === true;
  // The server still holds a registration this browser cannot receive with.
  const release = model.enabled === false && model.action === 'disable';

  return (
    <SettingsSection id="notifications" title="알림" description="새 메시지 알림을 이 브라우저에서 받을지 정합니다. 알림 권한은 여기서 켤 때만 요청합니다.">
      <dl className="flex flex-col gap-2">
        <InfoRow label="이 브라우저" value={supportLabel(model.support)} />
        <InfoRow label="알림 권한" value={permissionLabel(model.permission)} />
        <InfoRow label="현재 상태" value={stateLabel(model)} />
      </dl>

      <div className="flex items-start justify-between gap-4 rounded-sm bg-surface-soft px-4 py-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={switchId} className="text-[14px]">
            {release ? '이 브라우저의 알림 등록' : '새 메시지 알림'}
          </Label>
          <p className="text-[13px] leading-[1.43] text-muted">{description(model, release)}</p>
          <ActionReason state={state} id={reasonId} />
        </div>
        {release ? (
          <button
            id={switchId}
            type="button"
            disabled={!state.enabled || busy}
            aria-describedby={state.enabled ? undefined : reasonId}
            aria-busy={busy}
            onClick={() => void onToggle?.(false)}
            className="min-h-11 shrink-0 rounded-sm border border-control-border px-3 text-[14px] font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="settings-notifications-release"
          >
            등록 해제
          </button>
        ) : (
          <button
            id={switchId}
            type="button"
            role="switch"
            aria-checked={model.enabled === true}
            aria-describedby={state.enabled ? undefined : reasonId}
            aria-busy={busy}
            disabled={!state.enabled || busy}
            onClick={() => void onToggle?.(model.enabled !== true)}
            className="relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border border-control-border bg-canvas transition-colors aria-checked:border-ink aria-checked:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="settings-notifications-toggle"
          >
            <span className="sr-only">{model.enabled === true ? '알림 켜짐' : '알림 꺼짐'}</span>
            <span aria-hidden="true" className={`inline-flex size-6 items-center justify-center rounded-full transition-transform ${model.enabled === true ? 'translate-x-7 bg-canvas text-ink' : 'translate-x-1 bg-control-border text-canvas'}`}>
              {model.enabled === true ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
            </span>
          </button>
        )}
      </div>

      {(model.notice || busy) && (
        <div className="flex flex-wrap items-center gap-3">
          <p id={noticeId} role="status" className="text-[13px] leading-[1.43] text-body" data-testid="settings-notifications-notice">
            {busy ? '알림 설정을 변경하고 있습니다.' : model.notice}
          </p>
          {!busy && model.notice && onRetry && (
            <button type="button" onClick={onRetry} className="min-h-11 text-[13px] underline" data-testid="settings-notifications-retry">
              상태 다시 확인
            </button>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

function description(model: SettingsNotificationsModel, release: boolean): string {
  if (release) return '이 브라우저는 지금 알림을 받을 수 없지만 서버에는 등록이 남아 있습니다. 등록을 해제하면 이 브라우저로 알림을 보내지 않습니다.';
  if (model.enabled === null) return '이 브라우저의 알림 상태를 확인하고 있습니다.';
  if (model.enabled) return '이 브라우저로 새 메시지 알림을 보냅니다. 알림에는 메시지 내용이 포함되지 않습니다.';
  return '꺼져 있습니다. 켜면 이 브라우저에 새 메시지가 있음을 알립니다.';
}

function stateLabel(model: SettingsNotificationsModel): string {
  if (model.enabled === null) return '확인 중';
  if (model.enabled) return '이 브라우저에서 받는 중';
  return model.action === 'disable' ? '받지 않음 · 서버 등록 남아 있음' : '받지 않음';
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
