'use client';
import { sessionAllowsChat } from '@/core/api/session-contract';
import { AccountAccess } from '@/features/auth/account-access';
import { useEffect, useRef, useState } from 'react';
import { ApiError, validateProfile, type Profile, type Session } from '@/core/api/client';
import { sessionBinding } from '@/core/api/session-binding';
import { useApi } from '@/core/runtime/provider';
import { PrivateGate } from '@/features/auth/auth-panel';
import { clearLogoutPending, invalidateSession, setLogoutPending, usePrivateSession } from '@/features/auth/private-session';
import { useRoom } from '@/features/channel/session/use-room';
import { SettingsView } from './SettingsView';
import { usePushSettings } from '@/features/push/use-push-settings';
import { ProfileAvatar } from '@/features/media/ProfileAvatar';
import { AvatarEditor } from '@/features/media/AvatarEditor';
import { cleanupBinding, eraseSessionOutbox } from '@/features/auth/outbox-cleanup';
import { forgetChatMemory } from '@/features/chat/chat-memory';
import { revokeChatOutboxes } from '@/features/chat/chat-controller';
import { AccountDeletionControl, BlockedRoomsControl, ReportRecovery } from '@/features/privacy';
import { SessionMediaProvider } from '@/features/media/session-ui';
import type { SettingsProfilePatch, SettingsViewModel } from './types';
import { ActiveSessions } from './ActiveSessions';
export function RealSettings() {
  const { state, refresh } = usePrivateSession();
  if (state.kind !== 'ready') return <PrivateGate state={state} retry={refresh} allowAccountDeletion />;
  return <AccountSettings key={state.generation} session={state.session} profile={state.profile} generation={state.generation} refresh={refresh} />;
}
function AccountSettings({ session, profile: initial, generation, refresh }: { session: Session; profile: Profile; generation: number; refresh: () => void }) {
  const api = useApi();
  const room = useRoom();
  const push = usePushSettings(session, initial.id);
  const [profile, setProfile] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const loggingOut = useRef(false);
  const leaving = useRef(false);
  const saving = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const save = async (patch: SettingsProfilePatch & { avatarAssetId?: string | null }): Promise<boolean> => {
    if (busy || saving.current) return false;
    saving.current = true;
    setBusy(true); setNotice('');
    const controller = new AbortController(); request.current = controller;
    try {
      const next = await api.request<Profile>('/v1/me/profile', { method: 'PATCH', body: patch, csrf: session.csrfToken, signal: controller.signal });
      validateProfile(next);
      // Reconcile from persisted state before displaying a newly attached avatar.
      const confirmed = patch.avatarAssetId !== undefined ? await api.profile(controller.signal) : next;
      const binding = await api.session(controller.signal);
      if (!mounted.current) return false;
      if (binding.csrfToken !== session.csrfToken || !sessionAllowsChat(binding)) { invalidateSession(); return false; }
      if (patch.avatarAssetId !== undefined && (confirmed.avatar?.assetId ?? null) !== patch.avatarAssetId) throw new ApiError(502, 'INVALID_PROFILE');
      if (patch.avatarAssetId === null && confirmed.providerAvatarUrl) throw new ApiError(502, 'INVALID_PROFILE');
      setProfile(validateProfile(confirmed)); setNotice('프로필을 저장했습니다.');
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      if (e instanceof ApiError && [401, 403].includes(e.status)) { invalidateSession(); return false; }
      setNotice(e instanceof ApiError ? e.message : '변경 내용을 저장했는지 확인할 수 없어요. 다시 확인해 주세요.');
      return false;
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  const logout = async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    let marker: string;
    try {
      const binding = await sessionBinding(session.csrfToken);
      if (!mounted.current) return;
      marker = await setLogoutPending(binding, api.origin, session);
      await eraseSessionOutbox(api.origin, session);
    } catch { loggingOut.current = false; setNotice('지금은 로그아웃할 수 없어요. 잠시 후 다시 시도해 주세요.'); return; }
    // The local flag unmounts all private views before the command is sent. Do not abort logout on unmount.
    try {
      await api.request('/v1/auth/logout', { method: 'POST', csrf: session.csrfToken });
      clearLogoutPending(marker);
    } catch { /* Recovery gate preserves the pending flag and offers an explicit retry. */ }
  };
  const leave = async () => {
    if (room.kind !== 'ready' || !room.room.joined || leaving.current) return;
    leaving.current = true; setBusy(true); setNotice('');
    const controller = new AbortController(); request.current = controller;
    try {
      await api.request(`/v1/rooms/${encodeURIComponent(room.room.roomId)}/leave`, { method: 'POST', csrf: session.csrfToken, signal: controller.signal });
      invalidateSession();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && [401, 403].includes(e.status)) { invalidateSession(); return; }
      setNotice('채팅방을 나갔는지 확인할 수 없어요. 다시 확인해 주세요.');
    } finally { leaving.current = false; if (mounted.current) setBusy(false); }
  };
  const unavailable = (reason: string) => ({ enabled: false as const, reason });
  const model: SettingsViewModel = {
    profile: { ...profile, soopDisplayId: profile.soop?.displayId ?? null, avatarUrl: null, edit: busy ? unavailable('프로필을 저장하고 있습니다.') : { enabled: true } },
    soop: { status: session.soopLinkStatus === 'VERIFIED' ? 'linked' : 'unlinked', link: session.soopLinkStatus === 'VERIFIED' ? unavailable('SOOP 계정이 연결되어 있습니다.') : { enabled: true } },
    notifications: push.model,
    room: { roomName: room.kind === 'ready' ? room.room.name : '후로기', membership: room.kind === 'ready' && room.room.availability !== 'OWNER_PENDING' ? room.room.joined ? 'joined' : 'left' : room.kind === 'checking' ? 'unknown' : 'unavailable', isOwner: false, leave: room.kind === 'ready' && room.room.availability !== 'OWNER_PENDING' && room.room.joined && !busy ? { enabled: true } : unavailable(room.kind === 'unconfigured' ? '아직 채팅방이 열리지 않았습니다.' : '채팅방 참여 정보를 확인한 뒤 나갈 수 있습니다.') },
    session: { logout: { enabled: true } },
    account: { deletion: unavailable('계정 탈퇴 기능을 아직 제공하지 않습니다.') },
  };
  return <SessionMediaProvider csrf={session.csrfToken}><div className="mx-auto max-w-[40rem] px-4 pt-4"><p role="status">{notice || (room.kind === 'error' ? '채팅방 참여 정보를 확인하지 못했습니다.' : room.kind === 'unconfigured' ? '아직 채팅방이 열리지 않았습니다.' : '')}</p>{(notice || room.kind === 'error') && <button className="min-h-11 underline" onClick={refresh}>다시 확인</button>}</div><SettingsView model={model} onProfileChange={async patch => { await save(patch); }} onLogout={logout} onLinkSoop={async () => { try { window.location.assign(await api.authorize('link', session.csrfToken)); } catch { setNotice('SOOP 연결을 시작하지 못했습니다. 다시 시도해 주세요.'); } }} onLeaveRoom={leave} onToggleNotifications={push.toggle} onRetryNotifications={push.refresh}
    accountControls={<AccountDeletionControl origin={api.origin} session={session} generation={generation} cleanupBinding={current => cleanupBinding(api.origin, current)} onPrepare={current => eraseSessionOutbox(api.origin, current)} onBlocked={current => { revokeChatOutboxes(current.accountPartition, current.csrfToken); forgetChatMemory(); invalidateSession(); }} />}
    sessionsControls={<ActiveSessions session={session} />}
    privacyControls={<><AccountAccess session={session} /><ReportRecovery origin={api.origin} session={session} generation={generation} /><BlockedRoomsControl origin={api.origin} session={session} generation={generation} onReset={refresh} /></>}
    profileAvatar={<ProfileAvatar profile={profile} />}
    avatarEditor={<AvatarEditor hasProviderAvatar={!!profile.providerAvatarUrl} assetId={profile.avatar?.assetId ?? null} busy={busy} save={assetId => save({ avatarAssetId: assetId })} />} /></SessionMediaProvider>;
}
