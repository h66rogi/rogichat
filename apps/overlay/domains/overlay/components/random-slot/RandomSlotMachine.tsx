'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { RandomSlotCandidate } from '@/domains/overlay/hooks/use-overlay-socket';

/**
 * 랜덤 신청 시 오버레이에 띄우는 슬롯머신.
 *
 * 동작:
 * 1. 첫 렌더에서 translateY=0 으로 시작, requestAnimationFrame 다음 프레임에 finalTranslateY 로
 *    setState → CSS transition 이 실제 회전 애니메이션을 발동.
 * 2. ease-out cubic-bezier 로 감속하며 winner(첫번째 candidate) 카드 위치에서 정지.
 * 3. 멈춤 후 winner 카드 약한 강조 → autoDismissMs 후 onDismiss.
 *
 * 디자인 정책 (2026-05-14 update):
 * - 사이즈 축소: width 360, card height 64. 화면 영향 최소화.
 * - 중앙 약간 위 (top 38%, translateY(-50%))로 라이브 영상 가림 최소화.
 * - 배경 dim/blur 제거, 카드 자체에만 약한 glass 효과.
 * - 시간 단축: spin 2.0s + landed 1.4s ≈ 3.4s 안에 종료.
 */
export interface RandomSlotMachineProps {
  /** winner 가 candidates[0]. 최소 1곡. */
  candidates: RandomSlotCandidate[];
  /** 신청자 닉네임. 결과 라벨에 표시. */
  requester?: string;
  /** 회전 + 정지까지 ms. 기본 2000. */
  spinDurationMs?: number;
  /** 멈춤 후 dismiss 까지 ms. 기본 1400. */
  autoDismissMs?: number;
  /** dismiss 시 호출됨. */
  onDismiss: () => void;
}

const CARD_HEIGHT_PX = 64;
const REPEAT_FACTOR = 10;
const DEFAULT_SPIN_MS = 2000;
const DEFAULT_DISMISS_MS = 1400;

function RandomSlotMachineImpl({
  candidates,
  requester,
  spinDurationMs = DEFAULT_SPIN_MS,
  autoDismissMs = DEFAULT_DISMISS_MS,
  onDismiss,
}: RandomSlotMachineProps) {
  const [phase, setPhase] = useState<'spinning' | 'landed'>('spinning');
  // 애니메이션 fix: translateY 를 state 로 관리. 첫 렌더 = 0, 다음 frame 에 final 값.
  // CSS transition 이 0 → final 변경을 감지해 실제 회전을 보여줌.
  const [translateY, setTranslateY] = useState(0);

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const track = useMemo(() => {
    const out: RandomSlotCandidate[] = [];
    for (let i = 0; i < REPEAT_FACTOR; i++) {
      out.push(...candidates);
    }
    return out;
  }, [candidates]);

  const winnerIndex = useMemo(
    () => (REPEAT_FACTOR - 1) * candidates.length,
    [candidates.length],
  );
  const finalTranslateY = -winnerIndex * CARD_HEIGHT_PX;

  // 첫 프레임 0 → 다음 frame final 로 setState. CSS transition 이 실제 회전 발동.
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      // 더블 RAF 로 브라우저가 0 transform 을 한 번 paint 한 뒤 final 로 전이.
      requestAnimationFrame(() => setTranslateY(finalTranslateY));
    });
    return () => cancelAnimationFrame(rafId);
  }, [finalTranslateY]);

  useEffect(() => {
    phaseTimerRef.current = setTimeout(() => {
      setPhase('landed');
      dismissTimerRef.current = setTimeout(onDismiss, autoDismissMs);
    }, spinDurationMs);
    return () => {
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [spinDurationMs, autoDismissMs, onDismiss]);

  if (candidates.length === 0) return null;
  const winner = candidates[0];

  return (
    <div
      style={{
        position: 'fixed',
        top: '24%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Noto Sans KR", sans-serif',
        color: '#fff',
        pointerEvents: 'none',
        animation: 'rsm-fade-in 200ms ease-out both',
      }}
    >
      <style>{`
        @keyframes rsm-fade-in {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)); }
          to { opacity: 1; transform: translate(-50%, -50%); }
        }
        @keyframes rsm-winner-glow {
          0%, 100% { box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.6), 0 0 16px rgba(168, 85, 247, 0.45); }
          50%      { box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.9), 0 0 24px rgba(168, 85, 247, 0.7); }
        }
        @keyframes rsm-text-pop {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'rgba(255, 255, 255, 0.78)',
          textShadow: '0 1px 6px rgba(0, 0, 0, 0.6)',
        }}
      >
        {phase === 'landed' ? '랜덤 신청 결과' : '랜덤 추첨 중'}
      </div>

      <div
        style={{
          width: 360,
          height: CARD_HEIGHT_PX,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 14,
          background: 'rgba(18, 14, 32, 0.78)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
          animation:
            phase === 'landed'
              ? 'rsm-winner-glow 1.2s ease-in-out infinite'
              : undefined,
        }}
      >
        <div
          style={{
            transform: `translateY(${translateY}px)`,
            transition:
              phase === 'spinning'
                ? `transform ${spinDurationMs}ms cubic-bezier(0.08, 0.6, 0.25, 1)`
                : 'none',
            willChange: 'transform',
          }}
        >
          {track.map((song, idx) => (
            <SlotCard key={`${song.id}-${idx}`} song={song} />
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background:
              'linear-gradient(to bottom, rgba(18, 14, 32, 0.6) 0%, transparent 22%, transparent 78%, rgba(18, 14, 32, 0.6) 100%)',
          }}
        />
      </div>

      {phase === 'landed' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            animation: 'rsm-text-pop 240ms ease-out both',
            animationDelay: '60ms',
            opacity: 0,
            textShadow: '0 1px 6px rgba(0, 0, 0, 0.7)',
          }}
        >
          <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.7)' }}>
            {requester ? `${requester} 님` : '익명 시청자'} 곡 결정
          </div>
        </div>
      )}
    </div>
  );
}

function SlotCard({ song }: { song: RandomSlotCandidate }) {
  return (
    <div
      style={{
        height: CARD_HEIGHT_PX,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 14px',
        boxSizing: 'border-box',
      }}
    >
      {song.albumArt ? (
        <img
          src={song.albumArt}
          alt=""
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            objectFit: 'cover',
            flexShrink: 0,
            border: '1px solid rgba(255, 255, 255, 0.12)',
          }}
        />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            background:
              'linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(99, 102, 241, 0.4))',
            flexShrink: 0,
          }}
        />
      )}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: '#fff',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {song.title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'rgba(255, 255, 255, 0.6)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {song.artistName || ' '}
        </div>
      </div>
    </div>
  );
}

export const RandomSlotMachine = memo(RandomSlotMachineImpl);
