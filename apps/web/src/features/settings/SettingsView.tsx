'use client';

import { cn } from '@/shared/lib/cn';
import type { ReactNode } from 'react';

import { AccountDeletionSection } from './sections/AccountDeletionSection';
import { NotificationSection } from './sections/NotificationSection';
import { ProfileSection } from './sections/ProfileSection';
import { RoomLeaveSection } from './sections/RoomLeaveSection';
import { SessionSection } from './sections/SessionSection';
import { SoopConnectionSection } from './sections/SoopConnectionSection';
import type { SettingsProfilePatch, SettingsViewModel } from './types';

/**
 * 내 설정 screen. Purely presentational: every action is a callback the harness may
 * provide, and every section explains itself when an action is not available.
 * No browser permission, cookie, storage or network calls happen here.
 */
export interface SettingsViewProps {
  model: SettingsViewModel;
  onProfileChange?: ((patch: SettingsProfilePatch) => void | Promise<void>) | undefined;
  onLinkSoop?: (() => void | Promise<void>) | undefined;
  onToggleNotifications?: ((next: boolean) => void | Promise<void>) | undefined;
  onLeaveRoom?: (() => void | Promise<void>) | undefined;
  onLogout?: (() => void | Promise<void>) | undefined;
  onDeleteAccount?: (() => void | Promise<void>) | undefined;
  className?: string | undefined;
  avatarEditor?: ReactNode;
}

export function SettingsView({
  model,
  onProfileChange,
  onLinkSoop,
  onToggleNotifications,
  onLeaveRoom,
  onLogout,
  onDeleteAccount,
  className,
  avatarEditor,
}: SettingsViewProps) {
  return (
    <div className={cn('mx-auto flex w-full max-w-[40rem] flex-col gap-6 px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]', className)} data-testid="settings-view">
      <header className="flex flex-col gap-1">
        <h1 className="text-[24px] font-semibold text-ink">내 설정</h1>
        <p className="text-[14px] text-muted">프로필, SOOP 연결, 알림, 채팅방 참여와 계정을 관리합니다.</p>
      </header>

      {/* Keyed on the saved values so the local form resyncs after the harness applies a change. */}
      <ProfileSection key={profileKey(model)} model={model.profile} onChange={onProfileChange} avatarEditor={avatarEditor} />
      <SoopConnectionSection model={model.soop} onLink={onLinkSoop} />
      <NotificationSection model={model.notifications} onToggle={onToggleNotifications} />
      <RoomLeaveSection model={model.room} onLeave={onLeaveRoom} />
      <SessionSection model={model.session} onLogout={onLogout} />
      <AccountDeletionSection model={model.account} onDelete={onDeleteAccount} />
    </div>
  );
}

function profileKey(model: SettingsViewModel): string {
  const { nickname, birthday, birthdayVisibleToStreamers } = model.profile;
  return [nickname, birthday ? `${birthday.month}-${birthday.day}` : '', birthdayVisibleToStreamers ? '1' : '0'].join('|');
}
