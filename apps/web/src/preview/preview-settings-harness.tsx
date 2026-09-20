'use client';

import { SettingsView, type SettingsActionState, type SettingsViewModel } from '@/features/settings';
import { previewActors, previewRooms } from './fixtures/catalog';
import { PREVIEW_BANNER_TEXT } from './preview-frame';

const notWired = (what: string): SettingsActionState => ({
  enabled: false,
  reason: `${what}은(는) 미리보기에서 실행되지 않아요. 실제 계정 연결 후 사용할 수 있어요.`,
});

/** Synthetic settings model: every action is disabled with a reason, and no callback is supplied. */
export function buildPreviewSettingsModel(): SettingsViewModel {
  return {
    profile: {
      nickname: previewActors.fanA.displayName,
      avatarUrl: null,
      birthday: null,
      birthdayVisibleToStreamers: false,
      edit: notWired('프로필 저장'),
    },
    soop: { status: 'unlinked', link: notWired('SOOP 연결') },
    notifications: { support: 'unknown', permission: 'not-asked', enabled: false, toggle: notWired('알림 설정') },
    // Synthetic "joined" membership so the leave control and its disabled reason are visible in the preview.
    room: { roomName: previewRooms.hurogi.title, membership: 'joined', isOwner: false, leave: notWired('방 나가기') },
    session: { logout: notWired('로그아웃') },
    account: { deletion: notWired('계정 탈퇴') },
    previewNotice: PREVIEW_BANNER_TEXT,
  };
}

export function PreviewSettingsHarness() {
  return <SettingsView model={buildPreviewSettingsModel()} className="min-w-0 flex-1" />;
}
