'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/shared/ui/button';
import { MediaUploadPanel } from '@/features/media/components';
import { ScopedMediaImage, ScopedMediaVideo, useMediaRoomId, useMediaUpload } from '@/features/media/session-ui';
import type { MediaUpload } from '@/features/media/upload';
import type { ChatComposerSubmission, ChatComposerTarget, ChatImageContent, ChatSubmitResult } from './types';

export function ChatMediaImages({ messageId, media }: { messageId: string; media: ChatImageContent }) {
  const roomId = useMediaRoomId();
  if (!roomId) return <p>지금은 이미지를 표시할 수 없습니다.</p>;
  if (media.type === 'VIDEO') return <ScopedMediaVideo assetId={media.assets[0]!.assetId} context={{ roomId, messageId }} revision={media.revision} />;
  return <div className="space-y-2">{media.assets.map((asset, index) => <ScopedMediaImage key={asset.assetId} assetId={asset.assetId} revision={media.revision}
    context={{ variant: 'image', roomId, messageId, ...(media.stickerId ? { stickerId: media.stickerId } : {}) }}
    alt={media.type === 'STICKER' ? '대화 스티커' : `대화 사진 ${index + 1}`} />)}</div>;
}

/** Each visited target keeps its own upload. The room/session epoch owns all of them. */
export function PhotoDraftComposer(props: { submitBlockedReason?: string | undefined; kind?: 'PHOTO' | 'VIDEO'; target: ChatComposerTarget; onSubmit: (submission: ChatComposerSubmission) => Promise<ChatSubmitResult> | ChatSubmitResult; onClose: () => void }) {
  const upload = useMediaUpload(); const roomId = useMediaRoomId();
  if (!upload || !roomId) return <p role="status">지금은 첨부를 보낼 수 없습니다.</p>;
  return <PhotoDraft upload={upload} roomId={roomId} {...props} />;
}
function PhotoDraft({ upload, roomId, target, onSubmit, onClose, submitBlockedReason, kind = 'PHOTO' }: { submitBlockedReason?: string | undefined; kind?: 'PHOTO' | 'VIDEO'; upload: MediaUpload; roomId: string; target: ChatComposerTarget; onSubmit: (submission: ChatComposerSubmission) => Promise<ChatSubmitResult> | ChatSubmitResult; onClose: () => void }) {
  const label = kind === 'VIDEO' ? '영상' : '사진';
  const state = useSyncExternalStore(upload.subscribe, upload.getSnapshot, upload.getSnapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const retryId = useRef<string | undefined>(undefined);
  const ready = selected && state.phase === 'ready' && state.receipt?.assetId === selected;
  const send = async () => {
    if (!ready || pending.current || submitBlockedReason) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await onSubmit({ target, body: '', ...(kind === 'VIDEO' ? { video: upload } : { photo: upload }), ...(retryId.current ? { retryCommandId: retryId.current } : {}) });
      if (!upload.lifetime.isCurrent()) return;
      if (result.accepted) { retryId.current = undefined;
        upload.clear(); setSelected(null);
        if (result.note) setNotice(result.note);
        else onClose();
      }
      else { retryId.current = result.retryCommandId; setError(result.reason); }
    } catch { setError(`${label} 전송을 확인하지 못했습니다. 같은 첨부로 다시 확인해 주세요.`); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section aria-label={`${label} 보내기`} className="space-y-3 border-t border-line p-4">
    <p className="font-semibold">{label} 보내기</p>
    <p className="text-sm">{label}은 글과 별도로 보냅니다. 준비가 완료된 뒤 전송을 눌러 주세요.</p>
    <fieldset disabled={busy}><MediaUploadPanel upload={upload} lifetime={upload.lifetime} kind={kind} roomId={roomId} onReady={id => { if (selected !== id) retryId.current = undefined; setSelected(id); }} /></fieldset>
    {ready && kind === 'VIDEO' && <ScopedMediaVideo assetId={selected} context={{}} revision={`draft:${selected}`} />}
    {ready && kind === 'PHOTO' && <ScopedMediaImage assetId={selected} context={{ variant: 'image' }} alt="보낼 사진 미리보기" />}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="flex gap-3"><Button disabled={!ready || busy || Boolean(submitBlockedReason)} onClick={() => void send()}>{busy ? `${label} 보내는 중` : `${label} 보내기`}</Button>
      <Button variant="outline" disabled={busy} onClick={onClose}>{label} 첨부 닫기</Button></div>
  </section>;
}
