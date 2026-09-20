'use client';

import { useId, useState, type ReactNode } from 'react';
import { Cake, Lock } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

import type { SettingsBirthday, SettingsProfileModel, SettingsProfilePatch } from '../types';
import { ActionReason, SettingsSection, effectiveState } from './section-shell';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function ProfileSection({
  model,
  onChange,
  avatarEditor,
}: {
  model: SettingsProfileModel;
  onChange?: ((patch: SettingsProfilePatch) => void | Promise<void>) | undefined;
  avatarEditor?: ReactNode;
}) {
  const state = effectiveState(model.edit, onChange);
  const editable = state.enabled;
  const reasonId = useId();
  const nicknameId = useId();
  const monthId = useId();
  const dayId = useId();
  const visibilityId = useId();

  const [nickname, setNickname] = useState(model.nickname);
  const [birthday, setBirthday] = useState<SettingsBirthday | null>(model.birthday);
  const [visible, setVisible] = useState(model.birthdayVisibleToStreamers);

  const dirty = nickname !== model.nickname || !sameBirthday(birthday, model.birthday) || visible !== model.birthdayVisibleToStreamers;

  const save = () => {
    if (!editable || !onChange || !dirty) return;
    const patch: SettingsProfilePatch = {};
    if (nickname !== model.nickname) patch.nickname = nickname.trim();
    if (!sameBirthday(birthday, model.birthday)) patch.birthday = birthday;
    if (visible !== model.birthdayVisibleToStreamers) patch.birthdayVisibleToStreamers = visible;
    void onChange(patch);
  };

  return (
    <SettingsSection
      id="profile"
      title="프로필"
      description="채팅에서 보이는 이름과 사진, 선택 사항인 생일을 관리합니다."
      footer={
        <>
          <Button type="button" onClick={save} disabled={!editable || !dirty} aria-describedby={editable ? undefined : reasonId} data-testid="settings-profile-save">
            변경 내용 저장
          </Button>
          <ActionReason state={state} id={reasonId} />
        </>
      }
    >
      <div className="flex items-center gap-4">
        <Avatar className="size-16">
          {model.avatarUrl && <AvatarImage src={model.avatarUrl} alt="" />}
          <AvatarFallback className="text-[20px]" aria-hidden="true">
            {model.nickname.charAt(0) || '·'}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-1 text-[14px]">
          <span className="font-semibold text-ink">{model.nickname || '이름 없음'}</span>
          {!avatarEditor && <span className="text-muted">프로필 사진 변경은 사진 업로드가 준비된 뒤 제공됩니다.</span>}
        </div>
      </div>

      {avatarEditor}

      <div className="flex flex-col gap-2">
        <Label htmlFor={nicknameId}>닉네임</Label>
        <Input
          id={nicknameId}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          disabled={!editable}
          maxLength={20}
          autoComplete="nickname"
          aria-describedby={editable ? undefined : reasonId}
          data-testid="settings-profile-nickname"
        />
      </div>

      <fieldset className="flex flex-col gap-3" disabled={!editable}>
        <legend className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Cake className="size-4" aria-hidden="true" />
          생일 (선택)
        </legend>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={monthId} className="text-[13px] font-medium text-muted">
              월
            </Label>
            <select
              id={monthId}
              value={birthday?.month ?? ''}
              onChange={(e) => {
                const month = Number(e.target.value);
                setBirthday(month ? { month, day: birthday?.day ?? 1 } : null);
              }}
              className={selectClass}
              data-testid="settings-profile-birth-month"
            >
              <option value="">선택 안 함</option>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}월
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={dayId} className="text-[13px] font-medium text-muted">
              일
            </Label>
            <select
              id={dayId}
              value={birthday?.day ?? ''}
              onChange={(e) => {
                const day = Number(e.target.value);
                if (birthday) setBirthday({ month: birthday.month, day: day || 1 });
              }}
              disabled={!editable || birthday === null}
              className={selectClass}
              data-testid="settings-profile-birth-day"
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}일
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-sm bg-surface-soft px-4 py-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={visibilityId} className="text-[14px]">
              스트리머에게 생일 공개
            </Label>
            <p className="flex items-start gap-1.5 text-[13px] leading-[1.43] text-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {visible
                  ? '참여 중인 채팅방과 앞으로 참여하는 채팅방의 스트리머에게 월·일이 보입니다. 다른 팬에게는 보이지 않습니다.'
                  : '기본값은 비공개입니다. 켜면 참여하는 채팅방의 스트리머에게만 월·일이 보이고, 다른 팬에게는 보이지 않습니다.'}
              </span>
            </p>
          </div>
          <button
            id={visibilityId}
            type="button"
            role="switch"
            aria-checked={visible}
            disabled={!editable || birthday === null}
            onClick={() => setVisible((v) => !v)}
            className="relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border border-control-border bg-canvas transition-colors aria-checked:border-ink aria-checked:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="settings-profile-birthday-visible"
          >
            <span className="sr-only">{visible ? '공개 중' : '비공개'}</span>
            <span aria-hidden="true" className={`inline-block size-6 rounded-full bg-control-border transition-transform ${visible ? 'translate-x-7 bg-canvas' : 'translate-x-1'}`} />
          </button>
        </div>
        {birthday === null && <p className="text-[13px] text-muted">생일을 입력하지 않으면 공개 설정은 적용되지 않습니다.</p>}
      </fieldset>
    </SettingsSection>
  );
}

const selectClass =
  'h-12 min-w-[7rem] rounded-sm border border-control-border bg-canvas px-3 text-[16px] text-ink outline-none focus-visible:border-focus-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:bg-surface-soft disabled:opacity-60';

function sameBirthday(a: SettingsBirthday | null, b: SettingsBirthday | null): boolean {
  if (a === null || b === null) return a === b;
  return a.month === b.month && a.day === b.day;
}
