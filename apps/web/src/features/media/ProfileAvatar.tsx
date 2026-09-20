'use client';

import { useState } from 'react';
import type { Profile } from '@/core/api/client';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { ScopedMediaImage } from './session-ui';

/** Persisted assets use the existing session-scoped, expiring media access flow. */
export function ProfileAvatar({ profile }: { profile: Pick<Profile, 'nickname' | 'avatar' | 'providerAvatarUrl'> }) {
  if (profile.avatar) return <div className="w-16 shrink-0 [&_img]:size-16 [&_img]:rounded-full [&_img]:object-cover">
    <ScopedMediaImage assetId={profile.avatar.assetId} context={{ variant: 'image' }} alt="저장된 프로필 사진" />
  </div>;
  if (profile.providerAvatarUrl) return <ProviderAvatar key={profile.providerAvatarUrl} url={profile.providerAvatarUrl} />;
  return <Avatar className="size-16" role="img" aria-label="등록된 프로필 사진 없음">
    <AvatarFallback className="text-[20px]" aria-hidden="true">{profile.nickname.charAt(0) || '·'}</AvatarFallback>
  </Avatar>;
}

function ProviderAvatar({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="max-w-40 text-sm text-muted"><p>프로필 사진을 불러오지 못했습니다.</p><button className="min-h-11 underline" onClick={() => setFailed(false)}>사진 다시 보기</button></div>;
  // The API returns a validated canonical CDN URL, never an OAuth or arbitrary remote URL.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="저장된 프로필 사진" referrerPolicy="no-referrer" className="size-16 shrink-0 rounded-full object-cover" onError={() => setFailed(true)} />;
}
