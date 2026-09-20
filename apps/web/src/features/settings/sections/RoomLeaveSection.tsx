'use client';

import { useId, useState } from 'react';
import { DoorOpen } from 'lucide-react';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

import type { SettingsRoomModel } from '../types';
import { ActionReason, InfoRow, SettingsSection, effectiveState } from './section-shell';

export function RoomLeaveSection({ model, onLeave }: { model: SettingsRoomModel; onLeave?: (() => void | Promise<void>) | undefined }) {
  const state = effectiveState(model.leave, onLeave);
  const reasonId = useId();
  const [confirming, setConfirming] = useState(false);
  const joined = model.membership === 'joined';

  return (
    <SettingsSection
      id="room"
      title="채팅방 참여"
      description="채팅방을 나가도 계정은 유지되고, 이미 보낸 메시지는 삭제되지 않습니다. 다시 들어오면 새 참여로 시작합니다."
      footer={
        joined && (
          <div className="flex w-full flex-col gap-3">
            {confirming ? (
              <div className="flex flex-col gap-3 rounded-sm border border-line px-4 py-3" role="group" aria-label="채팅방 나가기 확인">
                <p className="text-[14px] text-body">
                  <strong className="font-semibold text-ink">{model.roomName}</strong>에서 나갈까요? 계정 탈퇴와는 다르며, 보낸 메시지는 그대로 남습니다.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="destructive" onClick={() => void onLeave?.()} disabled={!state.enabled} data-testid="settings-room-leave-confirm">
                    나가기
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                    취소
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => setConfirming(true)} disabled={!state.enabled} aria-describedby={state.enabled ? undefined : reasonId} data-testid="settings-room-leave">
                <DoorOpen className="size-4" aria-hidden="true" />
                채팅방 나가기
              </Button>
            )}
            <ActionReason state={state} id={reasonId} />
          </div>
        )
      }
    >
      <dl className="flex flex-col gap-2">
        <InfoRow label="채팅방" value={model.roomName} />
        <InfoRow
          label="상태"
          value={
            <span className="inline-flex items-center gap-2">
              <Badge variant={joined ? 'brand' : 'outline'} data-testid="settings-room-membership">
                {joined ? '참여 중' : model.membership === 'left' ? '나감' : '확인 중'}
              </Badge>
              {model.isOwner && <Badge variant="secondary">방장</Badge>}
            </span>
          }
        />
      </dl>
      {!joined && model.membership === 'left' && <p className="text-[13px] text-muted">채팅 화면에서 다시 입장할 수 있습니다. 입장은 직접 선택할 때만 진행됩니다.</p>}
    </SettingsSection>
  );
}
