import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card';
import { cn } from '@/shared/lib/cn';

import type { SettingsActionState } from '../types';

/** Common frame for a settings section: title, short description, body, actions. */
export function SettingsSection({
  id,
  title,
  description,
  children,
  footer,
  tone = 'default',
}: {
  id: string;
  title: string;
  description?: string | undefined;
  children?: ReactNode;
  footer?: ReactNode;
  tone?: 'default' | 'danger';
}) {
  const headingId = `settings-${id}-title`;
  return (
    <Card role="region" aria-labelledby={headingId} data-testid={`settings-section-${id}`} className={cn(tone === 'danger' && 'border-danger/40')}>
      <CardHeader>
        <CardTitle id={headingId}>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children && <CardContent className="flex flex-col gap-4">{children}</CardContent>}
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}

/** Explains why an action is unavailable. Rendered next to the disabled control. */
export function ActionReason({ state, id }: { state: SettingsActionState; id?: string | undefined }) {
  if (state.enabled) return null;
  return (
    <p id={id} className="text-[13px] leading-[1.43] text-muted" data-testid="settings-action-reason">
      {state.reason}
    </p>
  );
}

/** True when the control should be interactive: the harness allows it and wired a callback. */
export function canAct(state: SettingsActionState, callback: unknown): boolean {
  return state.enabled && typeof callback === 'function';
}

/** Reason shown when an action has no connected implementation. */
export const NOT_CONNECTED_REASON = '현재 이 기능을 이용할 수 없습니다.';

export function effectiveState(state: SettingsActionState, callback: unknown): SettingsActionState {
  if (!state.enabled) return state;
  if (typeof callback !== 'function') return { enabled: false, reason: NOT_CONNECTED_REASON };
  return state;
}

/** Key/value row used across sections. */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[14px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
