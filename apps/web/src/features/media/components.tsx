'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Button } from '@/shared/ui/button';
import type { ImageContext, ImageKind, MediaLifetime } from './contracts';
import { imageReferenceKey } from './contracts';
import type { MediaImageResource } from './image-resource';
import type { MediaUpload } from './upload';

const labels = {
  empty: '이미지를 선택하면 업로드가 시작됩니다.', reserving: '업로드를 준비하고 있습니다.',
  uploading: '이미지를 전송하고 있습니다.', checking: '서버에서 이미지를 확인하고 있습니다.',
  pending: '아직 처리 중입니다. 잠시 후 상태를 확인해 주세요.', ready: '이미지가 준비되었습니다.',
  failed: '이미지를 사용할 수 없습니다.', uncertain: '처리 결과를 확인하지 못했습니다. 새 업로드를 시작하면 중복 예약이 생길 수 있습니다.',
};

/** Caller owns one upload/lifetime per draft. onReady only hands off an ID; it never sends a message. */
export function MediaUploadPanel({ upload, lifetime, kind, roomId, onReady }: {
  upload: MediaUpload; lifetime: MediaLifetime; kind: ImageKind; roomId?: string;
  onReady: (assetId: string) => void;
}) {
  const state = useSyncExternalStore(upload.subscribe, upload.getSnapshot, upload.getSnapshot);
  const [invalid, setInvalid] = useState(false);
  const id = useId();
  useEffect(() => () => upload.clear(), [upload]);
  const authorized = upload.lifetime === lifetime && !lifetime.signal.aborted && lifetime.isCurrent();
  if (!authorized) return null;
  const busy = ['reserving', 'uploading', 'checking'].includes(state.phase);
  return <section aria-label={kind === 'AVATAR' ? '프로필 이미지 업로드' : '이미지 업로드'} className="space-y-3">
    <label htmlFor={id} className="block font-semibold">이미지 선택</label>
    <input id={id} type="file" accept={kind === 'STICKER' ? 'image/png,image/webp' : 'image/jpeg,image/png,image/webp'}
      disabled={state.phase !== 'empty'} aria-describedby={`${id}-status`} className="min-h-11 max-w-full"
      onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (!file) return;
        setInvalid(false);
        void upload.start(kind, file, roomId).catch(() => setInvalid(true));
      }} />
    <p id={`${id}-status`} role="status">{invalid ? '파일 형식과 크기를 확인해 주세요.' : labels[state.phase]}</p>
    <p className="text-sm text-ink-muted">{kind === 'STICKER' ? 'PNG·WebP, 최대 1MB' : 'JPEG·PNG·WebP, 최대 10MB'}</p>
    {['pending', 'uncertain'].includes(state.phase) && state.receipt &&
      <Button type="button" variant="outline" onClick={() => { void upload.refresh().catch(() => setInvalid(true)); }}>상태 다시 확인</Button>}
    {state.phase === 'ready' && <Button type="button" onClick={() => { onReady(upload.readyAsset()); }}>이 이미지 사용</Button>}
    {state.phase !== 'empty' && <Button type="button" variant="outline" onClick={() => {
      if (window.confirm('이 업로드를 화면에서 버릴까요? 서버의 처리나 삭제가 취소되는 것은 아닙니다.')) { upload.clear(); setInvalid(false); }
    }}>{busy ? '업로드 화면에서 버리기' : '이미지 선택 해제'}</Button>}
  </section>;
}

/** Resource and context must be stable and scoped to this exact visible reference. */
export function AuthorizedMediaImage({ resource, lifetime, assetId, context, alt }: {
  resource: MediaImageResource; lifetime: MediaLifetime; assetId: string; context: ImageContext; alt: string;
}) {
  const state = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  useEffect(() => { void resource.load(assetId, context); return () => resource.clear(); }, [resource, assetId, context]);
  if (resource.lifetime !== lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return null;
  if (state.phase === 'ready' && state.objectUrl && state.referenceKey === imageReferenceKey(assetId, context)) {
    // Only a local, expiring blob URL. Next's image proxy must not cache private media.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={state.objectUrl} alt={alt} className="max-h-96 max-w-full rounded-sm object-contain" onError={() => resource.clear()} />;
  }
  return <div className="space-y-2">
    <p role="status">{state.phase === 'loading' ? '이미지를 불러오고 있습니다.' : state.phase === 'expired' ? '이미지 접근 시간이 만료되었습니다.' : '이미지를 표시할 수 없습니다.'}</p>
    {state.phase !== 'loading' && <Button type="button" variant="outline" onClick={() => { void resource.load(assetId, context); }}>다시 불러오기</Button>}
  </div>;
}
