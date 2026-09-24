'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { usePitchShift } from '@/meloming/domains/overlay/hooks/use-pitch-shift';
import { PitchShiftControl } from '@/meloming/domains/overlay/components/pitch-shift-control';
import { patchConsoleSongMetadata } from '@/meloming/domains/channel/apis/songs';
import { songRequestKeys } from '@/meloming/domains/overlay/hooks/use-song-requests';
import { extractApiErrorMessage } from '@/meloming/shared/lib/api-error';
import { isCorsMediaPlaybackUrl } from '@/meloming/domains/overlay/utils/is-cors-media-playback-url';

interface PitchShiftSectionProps {
  fallbackVideoRef: RefObject<HTMLVideoElement | null>;
  useHtml5Player: boolean;
  fallbackVideoUrl: string | null;
  fallbackError: string | null;
  /** 곡이 바뀌면 pitch 를 0 으로 리셋하기 위한 식별자. */
  nowPlayingId: number | null | undefined;
  /** 원곡 키 표시용. */
  songKey?: string | null;
  /** 원곡 BPM 표시용. */
  bpm?: number | null;
  /** PATCH 대상 Song.id. 없으면 저장 비활성. */
  songId?: number | null;
  /** 채널 식별자(webPath 또는 channelId 문자열). PATCH 경로에 사용. */
  channelIdentifier?: string;
  /** 저장된 키. 곡 로드 시 초기값으로 적용. null/0 이면 0(원곡)으로. */
  savedPitchSemitones?: number | null;
  /** 저장 성공 후 nowPlaying 캐시 invalidate 용. null 이면 스킵. */
  sessionId?: number | null;
}

/**
 * 키 조절 (Pitch shift) UI + Web Audio graph 컨테이너.
 *
 * feature flag(`consolePitchShift`) 가 켜져 있을 때만 부모가 mount 한다.
 * 분리한 이유는 hook 호출 자체를 conditional 하게 만들어, flag 가 꺼져있을 때
 * `usePitchShift` 가 AudioContext 를 생성하지 않도록 보장하기 위함.
 * (React rules-of-hooks 상 NowPlayingCard 안에서 조건부로 hook 호출 불가.)
 *
 * 저장 흐름:
 * - 곡이 바뀌면 savedPitchSemitones 를 초기값으로 자동 적용 (없으면 0).
 * - 사용자가 슬라이더로 조정 후 "저장" 버튼 클릭 → PATCH 로 Song.preferredPitchSemitones 저장.
 * - karaokeUrl 이 바뀌면 백엔드가 r2CacheKey 와 함께 preferredPitchSemitones 도 자동 null 초기화.
 */
export function PitchShiftSection({
  fallbackVideoRef,
  useHtml5Player,
  fallbackVideoUrl,
  fallbackError,
  nowPlayingId,
  songKey,
  bpm,
  songId,
  channelIdentifier,
  savedPitchSemitones,
  sessionId,
}: PitchShiftSectionProps) {
  const queryClient = useQueryClient();

  // 곡 단위 저장값을 초기값으로 사용. 곡이 바뀌면 새 saved 값으로 재적용.
  const initialPitch = savedPitchSemitones ?? 0;
  const [pitchSemitones, setPitchSemitones] = useState(initialPitch);
  const [pitchBypass, setPitchBypass] = useState(false);

  // 곡 식별자 추적 ref — 곡 변경 시에만 reset, 같은 곡 안에서는 number 도착
  // 시에만 적용. 같은 곡 동안 savedPitchSemitones 가 일시적으로 null/undefined
  // 로 들어오는 경우(socket payload glitch / 응답 캐시 race 등)에 0 으로 덮어
  // 슬라이더가 stuck 되는 문제 방지 (2026-04-30 prod incident).
  const lastNowPlayingIdRef = useRef<typeof nowPlayingId>(undefined);
  useEffect(() => {
    const songChanged = lastNowPlayingIdRef.current !== nowPlayingId;
    if (songChanged) {
      lastNowPlayingIdRef.current = nowPlayingId;
      setPitchSemitones(savedPitchSemitones ?? 0);
      setPitchBypass(false);
      return;
    }
    // 같은 곡 — savedPitchSemitones 가 명시적 number 로 변경됐을 때만 적용.
    // null/undefined 는 응답 미도착 또는 일시적 glitch 로 간주하고 이전 값 유지.
    if (typeof savedPitchSemitones === 'number') {
      setPitchSemitones(savedPitchSemitones);
    }
  }, [nowPlayingId, savedPitchSemitones]);

  const isGatewayPlaybackUrl = isCorsMediaPlaybackUrl(fallbackVideoUrl);

  const pitchShiftState = usePitchShift(fallbackVideoRef, {
    enabled: useHtml5Player && isGatewayPlaybackUrl && !pitchBypass,
    pitchSemitones,
  });

  const saveMutation = useMutation({
    mutationFn: async (args: { capturedSongId: number; semitones: number }) => {
      if (!channelIdentifier) {
        throw new Error('channelIdentifier 가 비어있어 저장할 수 없습니다.');
      }
      return patchConsoleSongMetadata(
        channelIdentifier,
        args.capturedSongId,
        { preferredPitchSemitones: args.semitones },
      );
    },
    onSuccess: () => {
      if (sessionId !== null && sessionId !== undefined) {
        queryClient.invalidateQueries({
          queryKey: songRequestKeys.nowPlaying(sessionId),
        });
        queryClient.invalidateQueries({
          queryKey: songRequestKeys.queue(sessionId),
        });
      }
      toast.success('키 설정을 저장했어요');
    },
    onError: (err: unknown) => {
      toast.error(extractApiErrorMessage(err, '키 설정 저장에 실패했어요'));
    },
  });

  if (!useHtml5Player || !fallbackVideoUrl || fallbackError) {
    return null;
  }

  const canSave = !!songId && !!channelIdentifier && isGatewayPlaybackUrl;
  const isDirty = (savedPitchSemitones ?? 0) !== pitchSemitones;
  const handleSave = () => {
    if (!songId || saveMutation.isPending) return;
    saveMutation.mutate({ capturedSongId: songId, semitones: pitchSemitones });
  };
  const handleClear = () => {
    if (!songId || saveMutation.isPending) return;
    saveMutation.mutate({ capturedSongId: songId, semitones: 0 });
  };

  return (
    <PitchShiftControl
      value={pitchSemitones}
      onChange={setPitchSemitones}
      bypass={pitchBypass}
      onBypassChange={setPitchBypass}
      unsupported={pitchShiftState.unsupported}
      referenceKey={songKey}
      referenceBpm={bpm}
      unavailableReason={
        !isGatewayPlaybackUrl
          ? '이 영상은 키 조절을 지원하지 않습니다 (외부 호스팅)'
          : null
      }
      saveSlot={
        canSave
          ? {
              savedSemitones: savedPitchSemitones ?? null,
              isDirty,
              isSaving: saveMutation.isPending,
              onSave: handleSave,
              onClear: handleClear,
            }
          : null
      }
    />
  );
}
