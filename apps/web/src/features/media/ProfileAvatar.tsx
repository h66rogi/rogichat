'use client';

import { useState } from 'react';
import type { Profile } from '@/core/api/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { AvatarPlaceholder } from '@/shared/ui/avatar-placeholder';
import { ScopedMediaImage } from './session-ui';

/** Persisted assets use the existing session-scoped, expiring media access flow. */
export function ProfileAvatar({ profile }: { profile: Pick<Profile, 'nickname' | 'avatar' | 'providerAvatarUrl'> }) {
  if (profile.avatar) return <div className="w-16 shrink-0 [&_img]:size-16 [&_img]:rounded-full [&_img]:object-cover">
    <ScopedMediaImage assetId={profile.avatar.assetId} context={{ variant: 'image' }} alt="저장된 프로필 사진" presentation="avatar" />
  </div>;
  if (profile.providerAvatarUrl) return <ProviderAvatar key={profile.providerAvatarUrl} url={profile.providerAvatarUrl} />;
  return <Avatar className="size-16" role="img" aria-label="등록된 프로필 사진 없음">
    <AvatarFallback aria-hidden="true"><AvatarPlaceholder /></AvatarFallback>
  </Avatar>;
}

function ProviderAvatar({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return <Avatar className="size-16" role="img" aria-label="저장된 프로필 사진">
    {!failed && <AvatarImage src={url} alt="" referrerPolicy="no-referrer" onLoadingStatusChange={status => { if (status === 'error') setFailed(true); }} />}
    <AvatarFallback><AvatarPlaceholder /></AvatarFallback>
    {failed && <button type="button" className="absolute inset-0 rounded-full" aria-label="프로필 사진 다시 불러오기" onClick={() => setFailed(false)} />}
  </Avatar>;
}
