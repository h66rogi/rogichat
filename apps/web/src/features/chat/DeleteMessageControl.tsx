'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { Trash2 } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import type { ChatSubmitResult } from './types';

/** Ownership is established from the authorized message DTO; server rechecks it on deletion. */
export function DeleteMessageControl({ onDelete }: { onDelete: () => Promise<ChatSubmitResult> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const remove = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await onDelete();
      if (!mounted.current) return;
      if (result.accepted) setOpen(false);
      else setError(result.reason);
    } catch { if (mounted.current) setError('삭제 결과를 확인하지 못했습니다. 다시 시도해 주세요.'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <AlertDialog.Root open={open} onOpenChange={next => { if (!pending.current) { setOpen(next); setError(''); } }}>
    <AlertDialog.Trigger asChild>
      <button type="button" className="flex size-11 shrink-0 items-center justify-center self-center rounded-full text-muted hover:bg-surface-soft hover:text-danger" aria-label="내 메시지 삭제" data-testid="chat-delete">
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </AlertDialog.Trigger>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-canvas p-6 shadow-xl" aria-busy={busy}>
        <AlertDialog.Title className="text-lg font-semibold">이 메시지를 삭제할까요?</AlertDialog.Title>
        <AlertDialog.Description className="mt-3 text-sm text-muted">삭제하면 메시지와 이 메시지에서 공개된 내용은 더 이상 표시되지 않습니다. 되돌릴 수 없습니다.</AlertDialog.Description>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <AlertDialog.Cancel asChild><Button variant="outline" disabled={busy}>취소</Button></AlertDialog.Cancel>
          <Button disabled={busy} onClick={() => { void remove(); }} aria-busy={busy}>{busy ? '삭제 요청 중' : error ? '삭제 다시 시도' : '삭제 확인'}</Button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
