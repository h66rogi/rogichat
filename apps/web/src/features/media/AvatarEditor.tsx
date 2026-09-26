'use client';

import { useRef, useSyncExternalStore } from 'react';
import { Button } from '@/shared/ui/button';
import { MediaUploadPanel } from './components';
import { ScopedMediaImage, useMediaUpload } from './session-ui';
import type { MediaUpload } from './upload';

/** The saved profile remains authoritative; READY upload alone is not a profile save. */
export function AvatarEditor({ assetId, hasProviderAvatar = false, busy, save }: { assetId: string | null; hasProviderAvatar?: boolean; busy: boolean; save: (assetId: string | null) => Promise<boolean> }) {
  const upload = useMediaUpload();
  const pending = useRef(false);
  const apply = async (id: string | null) => {
    if (pending.current || busy) return;
    try { if (id !== null && (!upload || upload.readyAsset('AVATAR') !== id)) return; }
    catch { return; }
    pending.current = true;
    try { if (await save(id)) upload?.clear(); }
    finally { pending.current = false; }
  };
  return <div className="space-y-3" aria-label="프로필 사진 변경">
    {upload ? <AvatarUpload upload={upload} busy={busy} apply={apply} />
      : <p className="text-sm text-muted">지금은 프로필 사진 업로드를 사용할 수 없습니다.</p>}
    {(assetId || hasProviderAvatar) && <Button type="button" variant="outline" disabled={busy} onClick={() => void apply(null)}>프로필 사진 삭제</Button>}
  </div>;
}

function AvatarUpload({ upload, busy, apply }: { upload: MediaUpload; busy: boolean; apply: (id: string | null) => Promise<void> }) {
  const state = useSyncExternalStore(upload.subscribe, upload.getSnapshot, upload.getSnapshot);
  return <fieldset disabled={busy} className="min-w-0">
    {state.phase === 'ready' && state.receipt && <ScopedMediaImage assetId={state.receipt.assetId} context={{ variant: 'image' }} alt="선택한 프로필 사진 미리보기" />}
    <MediaUploadPanel upload={upload} lifetime={upload.lifetime} kind="AVATAR" onReady={id => { void apply(id); }} />
  </fieldset>;
}
