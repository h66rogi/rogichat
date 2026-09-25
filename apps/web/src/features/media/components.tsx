'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Button } from '@/shared/ui/button';
import { AvatarPlaceholder } from '@/shared/ui/avatar-placeholder';
import type { ImageContext, MediaKind, MediaLifetime } from './contracts';
import { imageReferenceKey } from './contracts';
import type { MediaImageResource } from './image-resource';
import type { MediaUpload } from './upload';

const labels = {
  empty: '파일을 선택해 주세요.', reserving: '파일을 준비하고 있어요.',
  uploading: '올리는 중이에요.', checking: '파일을 준비하고 있어요.',
  pending: '파일을 준비하고 있어요.', ready: '파일을 사용할 수 있어요.',
  failed: '파일을 사용할 수 없어요. 다시 선택해 주세요.', uncertain: '업로드가 지연되고 있어요.',
};

/** Caller owns one upload/lifetime per draft. onReady only hands off an ID; it never sends a message. */
export function MediaUploadPanel({ upload, lifetime, kind, roomId, onReady }: {
  upload: MediaUpload; lifetime: MediaLifetime; kind: MediaKind; roomId?: string;
  onReady: (assetId: string) => void;
}) {
  const state = useSyncExternalStore(upload.subscribe, upload.getSnapshot, upload.getSnapshot);
  const [invalid, setInvalid] = useState(false);
  const id = useId();
  useEffect(() => () => upload.clear(), [upload]);
  const authorized = upload.lifetime === lifetime && !lifetime.signal.aborted && lifetime.isCurrent();
  const busy = ['reserving', 'uploading', 'checking'].includes(state.phase);
  useEffect(() => {
    if (!authorized || !state.receipt || !['pending', 'uncertain'].includes(state.phase)) return;
    let requested = false;
    const retry = () => {
      if (requested || document.visibilityState !== 'visible') return;
      requested = true;
      void upload.refresh().catch(() => undefined);
    };
    const timer = window.setTimeout(retry, 15000);
    document.addEventListener('visibilitychange', retry);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', retry); };
  }, [authorized, upload, state.phase, state.receipt]);
  if (!authorized) return null;
  return <section aria-label={kind === 'AVATAR' ? '프로필 이미지 업로드' : kind === 'VIDEO' ? '영상 업로드' : '이미지 업로드'} className="space-y-3">
    <label htmlFor={id} className="block font-semibold">{kind === 'VIDEO' ? '영상 선택' : '이미지 선택'}</label>
    <input id={id} type="file" accept={kind === 'VIDEO' ? 'video/mp4,video/quicktime' : kind === 'STICKER' ? 'image/png,image/webp' : 'image/jpeg,image/png,image/webp'}
      disabled={state.phase !== 'empty'} aria-describedby={`${id}-status`} className="min-h-11 max-w-full"
      onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (!file) return;
        setInvalid(false);
        void upload.start(kind, file, roomId).catch(() => setInvalid(true));
      }} />
    <p id={`${id}-status`} role="status">{invalid ? '파일 형식과 크기를 확인해 주세요.' : state.phase === 'uncertain' && !state.receipt ? '업로드하지 못했어요. 다시 선택해 주세요.' : labels[state.phase]}</p>
    <p className="text-sm text-ink-muted">{kind === 'VIDEO' ? 'MP4·MOV, 최대 50MB·60초. 영상을 준비한 뒤 보낼 수 있어요.' : kind === 'STICKER' ? 'PNG·WebP, 최대 1MB' : 'JPEG·PNG·WebP, 최대 10MB'}</p>
    {['pending', 'uncertain'].includes(state.phase) && state.receipt &&
      <Button type="button" variant="outline" onClick={() => { void upload.refresh().catch(() => undefined); }}>다시 시도</Button>}
    {state.phase === 'ready' && <Button type="button" onClick={() => { onReady(upload.readyAsset()); }}>{kind === 'VIDEO' ? '이 영상 사용' : '이 이미지 사용'}</Button>}
    {state.phase !== 'empty' && <Button type="button" variant="outline" onClick={() => { upload.clear(); setInvalid(false); }}>{busy ? '취소' : '다른 파일 선택'}</Button>}
  </section>;
}

/** Resource and context must be stable and scoped to this exact visible reference. */
export function AuthorizedMediaImage({ resource, lifetime, assetId, context, alt, presentation = 'photo' }: {
  resource: MediaImageResource; lifetime: MediaLifetime; assetId: string; context: ImageContext; alt: string; presentation?: 'avatar' | 'photo';
}) {
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => { void resource.load(assetId, context); return () => resource.clear(); }, [resource, assetId, context]);
  if (resource.lifetime !== lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return null;
  if (state.phase === 'ready' && state.objectUrl && state.referenceKey === imageReferenceKey(assetId, context)) {
    // Only a local, expiring blob URL. Next's image proxy must not cache private media.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={state.objectUrl} alt={alt} className={presentation === 'avatar' ? 'size-full rounded-full object-cover' : 'max-h-96 max-w-full rounded-sm object-contain'} onError={() => resource.clear()} />;
  }
  if (presentation === 'avatar') return <div className="relative size-full">
    <AvatarPlaceholder />
    {(state.phase === 'unavailable' || state.phase === 'expired') && <button type="button" className="absolute inset-0 rounded-full" aria-label="프로필 사진 다시 불러오기" onClick={() => { void resource.load(assetId, context); }} />}
  </div>;
  if (state.phase === 'loading' || state.phase === 'empty') return <div className="h-40 w-full rounded-xl bg-surface-strong motion-safe:animate-pulse" role="status" aria-label="이미지 불러오는 중" />;
  return <div className="space-y-2">
    <p role="status">{state.phase === 'expired' ? '이미지 접근 시간이 만료되었습니다.' : '이미지를 표시할 수 없습니다.'}</p>
    <Button type="button" variant="outline" onClick={() => { void resource.load(assetId, context); }}>다시 불러오기</Button>
  </div>;
}
