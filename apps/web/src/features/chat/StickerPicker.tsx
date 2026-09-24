'use client';

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/shared/ui/button';
import { ScopedMediaImage, useMediaRoomId, useMediaScope } from '@/features/media/session-ui';
import { StickerCatalog } from '@/features/media/sticker-catalog';
import type { ChatComposerSubmission, ChatComposerTarget, ChatSubmitResult } from './types';

export function StickerPicker(props: { submitBlockedReason?: string | undefined; target: ChatComposerTarget; onSubmit: (submission: ChatComposerSubmission) => ChatSubmitResult | Promise<ChatSubmitResult>; onClose: () => void }) {
  const scope = useMediaScope(); const roomId = useMediaRoomId();
  const [catalog, setCatalog] = useState<StickerCatalog | null>(null);
  useLayoutEffect(() => {
    if (!scope?.configured || !roomId) return;
    const current = new StickerCatalog(scope.client, roomId);
    let active = true;
    queueMicrotask(() => { if (active) { setCatalog(current); void current.load(); } });
    return () => { active = false; current.dispose(); };
  }, [scope, roomId]);
  if (scope && !scope.configured) return <p role="status">지금은 스티커를 사용할 수 없습니다.</p>;
  if (!scope || !roomId || catalog?.lifetime !== scope.lifetime) return <p role="status">스티커 목록을 확인하고 있습니다.</p>;
  return <CatalogPicker catalog={catalog} roomId={roomId} {...props} />;
}
function CatalogPicker({ catalog, roomId, target, onSubmit, onClose, submitBlockedReason }: { submitBlockedReason?: string | undefined; catalog: StickerCatalog; roomId: string; target: ChatComposerTarget; onSubmit: (submission: ChatComposerSubmission) => ChatSubmitResult | Promise<ChatSubmitResult>; onClose: () => void }) {
  const state = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot, catalog.getSnapshot);
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const [notice, setNotice] = useState('');
  const retryId = useRef<string | undefined>(undefined);
  const send = async () => {
    if (!state.selected || pending.current || submitBlockedReason) return;
    pending.current = true; setBusy(true); setNotice('');
    try {
      const result = await onSubmit({ target, body: '', sticker: catalog, ...(retryId.current ? { retryCommandId: retryId.current } : {}) });
      if (!catalog.lifetime.isCurrent()) return;
      if (result.accepted) { retryId.current = undefined; catalog.clear(); if (result.note) setNotice(result.note); else onClose(); }
      else { retryId.current = result.retryCommandId; setNotice(result.reason); }
    } catch { setNotice('스티커 전송을 확인하지 못했습니다. 다시 확인해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className="space-y-3 border-t border-line p-4" aria-label="스티커 보내기">
    <p className="font-semibold">스티커 보내기</p>
    {state.phase === 'loading' && <p role="status">스티커 목록을 불러오고 있습니다.</p>}
    {state.phase === 'error' && <p role="alert">스티커 목록을 확인하지 못했습니다. 다시 시도해 주세요.</p>}
    {state.phase === 'ready' && state.items.length === 0 && <p role="status">사용할 수 있는 스티커가 없습니다.</p>}
    <div className="flex flex-wrap gap-2">{state.items.map(item => <Button key={item.id} type="button" variant="outline" aria-pressed={state.selected?.id === item.id} disabled={busy} onClick={() => {
      try { if (state.selected?.id !== item.id) retryId.current = undefined; catalog.select(item.id); setNotice(''); } catch { setNotice('스티커 목록을 다시 확인해 주세요.'); }
    }}>{item.label}</Button>)}</div>
    {state.selected && <ScopedMediaImage assetId={state.selected.assetId} context={{ variant: 'image', roomId, stickerId: state.selected.id }} alt={`선택한 스티커: ${state.selected.label}`} />}
    <div className="flex flex-wrap gap-2">
      {state.next && <Button variant="outline" disabled={busy} onClick={() => { void catalog.load(state.next!); }}>다음 스티커</Button>}
      <Button variant="outline" disabled={busy || state.phase === 'loading'} onClick={() => { void catalog.load(); }}>스티커 목록 다시 확인</Button>
      <Button disabled={busy || !state.selected || Boolean(submitBlockedReason)} onClick={() => { void send(); }}>{busy ? '스티커 보내는 중' : '스티커 보내기'}</Button>
      <Button variant="outline" disabled={busy} onClick={onClose}>스티커 선택 닫기</Button>
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
