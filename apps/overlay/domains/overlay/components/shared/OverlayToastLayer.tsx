'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  RequestFeedbackData,
  InfoDisplayData,
  SongbookAddFeedbackData,
} from '@/domains/overlay/hooks/use-overlay-socket';

type ToastKind = 'accepted' | 'rejected' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  lines: string[];
}

interface OverlayToastController {
  pushFeedback: (data: RequestFeedbackData) => void;
  pushInfo: (data: InfoDisplayData) => void;
  pushSongbookFeedback: (data: SongbookAddFeedbackData) => void;
}

const TOAST_LIFETIME_MS = 6000;
const MAX_VISIBLE = 3;

/**
 * 고정 위치 토스트 레이어. total 오버레이 우상단에 쌓인다.
 * 사용 예:
 *   const toastRef = useRef<OverlayToastController>(null);
 *   useOverlaySocket(token, {
 *     onRequestFeedback: (d) => toastRef.current?.pushFeedback(d),
 *     onInfoDisplay: (d) => toastRef.current?.pushInfo(d),
 *   });
 *   <OverlayToastLayer ref={toastRef} />
 */
export function useOverlayToastController(): OverlayToastController & {
  toasts: Toast[];
  dismiss: (id: number) => void;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const dismiss = useCallback((id: number) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, lines: string[]) => {
      const id = nextIdRef.current++;
      setToasts((prev) => {
        const next = [...prev, { id, kind, title, lines }];
        // Trim from the oldest when exceeding max visible
        while (next.length > MAX_VISIBLE) {
          const removed = next.shift();
          if (removed) {
            const t = timersRef.current.get(removed.id);
            if (t) clearTimeout(t);
            timersRef.current.delete(removed.id);
          }
        }
        return next;
      });
      const timer = setTimeout(() => dismiss(id), TOAST_LIFETIME_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const pushFeedback = useCallback(
    (data: RequestFeedbackData) => {
      const song = [data.rawArtist, data.rawTitle].filter(Boolean).join(' - ');
      const header = `${data.nickname}${data.source === 'DONATION' ? ' · 후원' : ''}`;
      if (data.outcome === 'accepted') {
        push('accepted', '신청 수락', [header, song].filter(Boolean));
      } else {
        push(
          'rejected',
          '신청 실패',
          [header, song, data.reason ?? ''].filter(Boolean),
        );
      }
    },
    [push],
  );

  const pushInfo = useCallback(
    (data: InfoDisplayData) => {
      const header = data.nickname ? `${data.nickname}님 요청` : '';
      push('info', data.title, [header, ...(data.lines ?? [])].filter(Boolean));
    },
    [push],
  );

  const pushSongbookFeedback = useCallback(
    (data: SongbookAddFeedbackData) => {
      const songLine =
        data.title && data.artistName
          ? `${data.title} - ${data.artistName}`
          : data.title || data.query;
      const header = data.nickname ? `${data.nickname}` : '';

      switch (data.outcome) {
        case 'accepted':
          push(
            'accepted',
            '노래책에 추가했어요',
            [header, songLine].filter(Boolean),
          );
          break;
        case 'already_exists':
          push(
            'rejected',
            '이미 노래책에 있어요',
            [header, songLine].filter(Boolean),
          );
          break;
        case 'rejected_no_match':
          push(
            'rejected',
            '어떤 곡인지 못 찾았어요',
            [header, `"${data.query}"`].filter(Boolean),
          );
          break;
        case 'rejected_no_permission':
          push(
            'rejected',
            '스트리머만 사용할 수 있어요',
            [header].filter(Boolean),
          );
          break;
        case 'low_confidence':
          push(
            'rejected',
            '확신이 부족해요',
            [
              header,
              songLine ? `${songLine}?` : '',
              '정확히 다시 입력해주세요',
            ].filter(Boolean),
          );
          break;
        case 'error':
        default:
          push(
            'rejected',
            '잠시 후 다시 시도해주세요',
            [header, data.reason ?? ''].filter(Boolean),
          );
          break;
      }
    },
    [push],
  );

  return {
    toasts,
    dismiss,
    pushFeedback,
    pushInfo,
    pushSongbookFeedback,
  };
}

interface OverlayToastLayerProps {
  toasts: Toast[];
  onDismiss?: (id: number) => void;
}

const ACCENT: Record<ToastKind, string> = {
  accepted: 'bg-emerald-400',
  rejected: 'bg-rose-400',
  info: 'bg-sky-400',
};

export function OverlayToastLayer({ toasts, onDismiss }: OverlayToastLayerProps) {
  return (
    <div
      className="pointer-events-none fixed top-6 right-6 z-[9999] flex flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const isInfo = t.kind === 'info';
        return (
          <div
            key={t.id}
            onClick={() => onDismiss?.(t.id)}
            className={`pointer-events-auto overflow-hidden rounded-lg bg-neutral-900/90 text-white shadow-lg backdrop-blur-sm ring-1 ring-white/10 animate-in fade-in slide-in-from-top-2 duration-200 ${
              isInfo
                ? 'min-w-[360px] max-w-[480px]'
                : 'min-w-[260px] max-w-[360px]'
            }`}
          >
            <div className="flex">
              <div
                className={`${isInfo ? 'w-1.5' : 'w-1'} ${ACCENT[t.kind]}`}
                aria-hidden
              />
              <div className={isInfo ? 'flex-1 px-5 py-4' : 'flex-1 px-4 py-3'}>
                <div
                  className={`font-semibold leading-tight ${
                    isInfo ? 'text-base' : 'text-sm'
                  }`}
                >
                  {t.title}
                </div>
                <div
                  className={`mt-2 space-y-1.5 text-white/85 leading-relaxed ${
                    isInfo ? 'text-sm' : 'text-xs'
                  }`}
                >
                  {t.lines.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
